// =============================================================================
// FireISP 5.0 — FireRelay Service
// =============================================================================
// Core relay logic: node registry, health-check polling loop, routing table
// CRUD, least-loaded-node selection, fan-out merge, and retry with backoff.
// =============================================================================

const db = require('../config/database');
const relayConfig = require('../config/firerelay');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { ExternalServiceError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'firerelay' });

// One circuit breaker per worker node, keyed by node id
const nodeBreakers = new Map();

function getNodeBreaker(nodeId) {
  if (!nodeBreakers.has(nodeId)) {
    nodeBreakers.set(
      nodeId,
      createCircuitBreaker({ name: `firerelay:${nodeId}`, threshold: 5, resetMs: 60000 }),
    );
  }
  return nodeBreakers.get(nodeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal HTTP helper — makes a request to a worker node with retry + backoff
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an HTTP request to a worker node.
 * @param {string} baseUrl - Worker API base URL
 * @param {object} opts
 * @param {string} opts.method  - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} opts.path    - API path (e.g. /api/clients/123)
 * @param {object} [opts.body]  - JSON body for POST/PUT
 * @param {object} [opts.headers] - Additional headers to forward
 * @param {number} [opts.timeout] - Request timeout in ms
 * @returns {Promise<{status: number, data: any}>}
 */
async function httpRequest(baseUrl, { method = 'GET', path = '/', body, headers = {}, timeout } = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const timeoutMs = timeout || relayConfig.requestTimeout;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOpts.body = JSON.stringify(body);
    }
    const res = await fetch(url, fetchOpts);
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP request with retry and exponential backoff.
 * @param {string} baseUrl
 * @param {object} opts - same as httpRequest
 * @param {number} [maxRetries] - override relayConfig.maxRetries
 * @returns {Promise<{status: number, data: any}>}
 */
async function httpWithRetry(baseUrl, opts, maxRetries) {
  const retries = maxRetries ?? relayConfig.maxRetries;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpRequest(baseUrl, opts);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List registered nodes with pagination (for API use).
 */
async function listNodes({ page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    'SELECT * FROM firerelay_nodes ORDER BY created_at ASC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  const [countResult] = await db.query('SELECT COUNT(*) AS total FROM firerelay_nodes');
  const total = countResult[0].total;
  return {
    data: rows,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * List ALL registered nodes (internal use by health loop and fan-out).
 */
async function listAllNodes() {
  const [rows] = await db.query('SELECT * FROM firerelay_nodes ORDER BY created_at ASC');
  return rows;
}

/**
 * Get a single node by id.
 */
async function getNode(nodeId) {
  const [rows] = await db.query('SELECT * FROM firerelay_nodes WHERE id = ?', [nodeId]);
  if (rows.length === 0) throw new NotFoundError('firerelay_nodes');
  return rows[0];
}

/**
 * Register a new worker node.
 */
async function registerNode({ id, name, api_url }) {
  await db.query(
    'INSERT INTO firerelay_nodes (id, name, api_url, status) VALUES (?, ?, ?, \'active\')',
    [id, name || '', api_url],
  );
  return getNode(id);
}

/**
 * Update a node's fields (status, metrics, etc.).
 */
async function updateNode(nodeId, fields) {
  const COLUMN_MAP = {
    name: '`name` = ?',
    api_url: '`api_url` = ?',
    status: '`status` = ?',
    client_count: '`client_count` = ?',
    device_count: '`device_count` = ?',
    cpu_percent: '`cpu_percent` = ?',
    memory_percent: '`memory_percent` = ?',
    disk_percent: '`disk_percent` = ?',
    db_size_mb: '`db_size_mb` = ?',
    uptime_seconds: '`uptime_seconds` = ?',
    last_seen_at: '`last_seen_at` = ?',
  };
  const sets = [];
  const params = [];
  for (const [key, clause] of Object.entries(COLUMN_MAP)) {
    if (fields[key] !== undefined) {
      sets.push(clause);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return getNode(nodeId);
  params.push(nodeId);
  const [result] = await db.query(
    `UPDATE firerelay_nodes SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
  if (result.affectedRows === 0) throw new NotFoundError('firerelay_nodes');
  return getNode(nodeId);
}

/**
 * Deregister (delete) a worker node.
 * Also removes its client routing entries.
 */
async function deregisterNode(nodeId) {
  // Remove routing entries first (FK constraint)
  await db.query('DELETE FROM firerelay_client_routing WHERE node_id = ?', [nodeId]);
  const [result] = await db.query('DELETE FROM firerelay_nodes WHERE id = ?', [nodeId]);
  if (result.affectedRows === 0) throw new NotFoundError('firerelay_nodes');
  // Clean up circuit breaker
  nodeBreakers.delete(nodeId);
  return { deleted: true, id: nodeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health-Check Polling
// ─────────────────────────────────────────────────────────────────────────────

let healthInterval = null;

/**
 * Poll a single worker node's health endpoint and update the registry.
 */
async function pollNodeHealth(node) {
  const breaker = getNodeBreaker(node.id);
  try {
    const { status, data } = await breaker.call(() =>
      httpRequest(node.api_url, { path: '/api/firerelay/health' }),
    );
    if (status === 200 && data) {
      await updateNode(node.id, {
        client_count: data.client_count ?? node.client_count,
        device_count: data.device_count ?? node.device_count,
        cpu_percent: data.cpu_percent,
        memory_percent: data.memory_percent,
        disk_percent: data.disk_percent,
        db_size_mb: data.db_size_mb,
        uptime_seconds: data.uptime_seconds,
        last_seen_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        // If the node was offline and responded, bring it back to active
        ...(node.status === 'offline' ? { status: 'active' } : {}),
      });
      logger.debug({ nodeId: node.id }, 'Health check OK');
    }
  } catch (err) {
    logger.warn({ nodeId: node.id, err: err.message }, 'Health check failed');
    // Mark as offline after circuit breaker opens
    const state = breaker.getState();
    if (state.state === 'open' && node.status !== 'offline') {
      try {
        await updateNode(node.id, { status: 'offline' });
      } catch (_updateErr) {
        // best effort
      }
    }
  }
}

/**
 * Start the periodic health-check polling loop.
 * Only runs when FIRERELAY_MODE=master.
 */
function startHealthLoop() {
  if (relayConfig.mode !== 'master') return;
  if (healthInterval) return; // already running

  healthInterval = setInterval(async () => {
    try {
      const nodes = await listAllNodes();
      await Promise.allSettled(nodes.map(n => pollNodeHealth(n)));
    } catch (err) {
      logger.error({ err }, 'Health loop error');
    }
  }, relayConfig.healthInterval);

  // Unref so the timer doesn't prevent process exit
  if (healthInterval.unref) healthInterval.unref();
  logger.info({ intervalMs: relayConfig.healthInterval }, 'Health polling started');
}

/**
 * Stop the health-check polling loop.
 */
function stopHealthLoop() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up which node owns a given client.
 * @returns {string|null} node_id or null if not found (client is local)
 */
async function lookupClientNode(clientId) {
  const [rows] = await db.query(
    'SELECT node_id FROM firerelay_client_routing WHERE client_id = ?',
    [clientId],
  );
  return rows.length > 0 ? rows[0].node_id : null;
}

/**
 * Record that a client is owned by a specific node.
 */
async function assignClient(clientId, nodeId) {
  await db.query(
    'INSERT INTO firerelay_client_routing (client_id, node_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE node_id = VALUES(node_id)',
    [clientId, nodeId],
  );
}

/**
 * Remove a client from the routing table.
 */
async function unassignClient(clientId) {
  await db.query('DELETE FROM firerelay_client_routing WHERE client_id = ?', [clientId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Least-Loaded Node Selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select the active node with the lowest client_count.
 * Returns null if no active nodes exist.
 */
async function selectLeastLoadedNode() {
  const [rows] = await db.query(
    'SELECT * FROM firerelay_nodes WHERE status = \'active\' ORDER BY client_count ASC LIMIT 1',
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan-Out / Merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fan out a request to all healthy (non-offline) nodes simultaneously.
 * Merges JSON responses and appends warnings for any failed nodes.
 *
 * @param {object} opts
 * @param {string} opts.method  - HTTP method
 * @param {string} opts.path    - API path
 * @param {object} [opts.body]  - JSON body
 * @param {object} [opts.headers] - Headers to forward
 * @returns {Promise<{results: Array, warnings: string[]}>}
 */
async function fanOut({ method = 'GET', path, body, headers } = {}) {
  const nodes = await listAllNodes();
  const healthyNodes = nodes.filter(n => n.status !== 'offline');
  const warnings = [];

  const promises = healthyNodes.map(async (node) => {
    try {
      const { status, data } = await httpWithRetry(node.api_url, { method, path, body, headers });
      if (status >= 200 && status < 300 && data) {
        return { nodeId: node.id, data };
      }
      warnings.push(`Node ${node.id} returned status ${status}`);
      return null;
    } catch (_err) {
      warnings.push(`Node ${node.id} is unreachable — results may be incomplete.`);
      return null;
    }
  });

  // Add warnings for offline nodes
  const offlineNodes = nodes.filter(n => n.status === 'offline');
  for (const n of offlineNodes) {
    warnings.push(`Node ${n.id} is offline — results may be incomplete.`);
  }

  const settled = await Promise.allSettled(promises);
  const results = settled
    .filter(s => s.status === 'fulfilled' && s.value !== null)
    .map(s => s.value);

  return { results, warnings };
}

/**
 * Proxy a request to a specific worker node.
 * @param {string} nodeId
 * @param {object} opts
 * @returns {Promise<{status: number, data: any}>}
 */
async function proxyToNode(nodeId, opts) {
  const node = await getNode(nodeId);
  if (node.status === 'offline') {
    throw new ExternalServiceError('FireRelay', `Node ${nodeId} is offline`);
  }
  const breaker = getNodeBreaker(nodeId);
  return breaker.call(() => httpWithRetry(node.api_url, opts));
}

module.exports = {
  // HTTP helpers (exported for testing)
  httpRequest,
  httpWithRetry,
  // Node registry
  listNodes,
  listAllNodes,
  getNode,
  registerNode,
  updateNode,
  deregisterNode,
  // Health polling
  pollNodeHealth,
  startHealthLoop,
  stopHealthLoop,
  // Routing table
  lookupClientNode,
  assignClient,
  unassignClient,
  // Selection
  selectLeastLoadedNode,
  // Fan-out
  fanOut,
  proxyToNode,
  // Internal (for testing)
  getNodeBreaker,
  nodeBreakers,
};
