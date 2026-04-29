// =============================================================================
// FireISP 5.0 — Topology Context Service (P1 §3.1)
// =============================================================================
// Walks the network graph from a contract's CPE up to the edge/core device
// and produces a clean context snapshot for the AI Reply Assistant.
//
// The computed path is cached in `contract_topology_paths` and invalidated
// whenever a related Contract, Device, or NetworkLink changes.
//
// Public API:
//   buildPath(contractId)   — (re)compute and cache the topology path
//   getPath(contractId)     — return cached path, rebuilding on miss
//   summarize(contractId)   — return human-friendly snapshot for LLM prompt
//   invalidate(id, type)    — delete cached path(s); type = 'contract' | 'device' | 'link'
// =============================================================================

const db = require('../config/database');
const ContractTopologyPath = require('../models/ContractTopologyPath');
const logger = require('../utils/logger').child({ service: 'topologyContextService' });

/** Maximum hops we will traverse before declaring a loop. */
const MAX_HOPS = 20;

// =============================================================================
// Internal graph helpers
// =============================================================================

/**
 * Load all devices and network links for the organization that owns a contract.
 * Returns maps for fast lookup during graph traversal.
 *
 * @param {number} orgId
 * @returns {Promise<{ deviceMap: Map, linksByDevice: Map }>}
 */
async function loadGraph(orgId) {
  const [deviceRows] = await db.query(
    `SELECT id, contract_id, role, status, type, site_id
     FROM devices
     WHERE deleted_at IS NULL
       AND (organization_id = ? OR site_id IN (SELECT id FROM sites WHERE organization_id = ?))`,
    [orgId, orgId],
  );

  const [linkRows] = await db.query(
    `SELECT id, device_a_id, device_b_id, medium, role, status
     FROM network_links
     WHERE status != 'decommissioned'
       AND deleted_at IS NULL
       AND (
         device_a_id IN (SELECT id FROM devices WHERE deleted_at IS NULL AND (organization_id = ? OR site_id IN (SELECT id FROM sites WHERE organization_id = ?)))
       )`,
    [orgId, orgId],
  );

  const deviceMap = new Map(deviceRows.map(d => [d.id, d]));

  // Build adjacency map: device_id → [{ linkId, neighborId, medium, role }]
  const linksByDevice = new Map();
  for (const link of linkRows) {
    if (!linksByDevice.has(link.device_a_id)) linksByDevice.set(link.device_a_id, []);
    if (!linksByDevice.has(link.device_b_id)) linksByDevice.set(link.device_b_id, []);
    linksByDevice.get(link.device_a_id).push({
      linkId: link.id,
      neighborId: link.device_b_id,
      medium: link.medium,
      role: link.role,
    });
    linksByDevice.get(link.device_b_id).push({
      linkId: link.id,
      neighborId: link.device_a_id,
      medium: link.medium,
      role: link.role,
    });
  }

  return { deviceMap, linksByDevice };
}

/**
 * Walk from `startDeviceId` toward a 'core' or 'backhaul' device using BFS.
 * Returns the ordered path as [{device_id, role, link_id, medium}].
 * Returns null when no edge device is reachable or a loop is detected.
 *
 * @param {number}  startDeviceId
 * @param {Map}     deviceMap
 * @param {Map}     linksByDevice
 * @returns {Array|null}
 */
function traverseToEdge(startDeviceId, deviceMap, linksByDevice) {
  const visited = new Set();
  const queue = [{ deviceId: startDeviceId, path: [] }];

  while (queue.length > 0) {
    const { deviceId, path } = queue.shift();

    if (visited.has(deviceId)) continue;
    visited.add(deviceId);

    const device = deviceMap.get(deviceId);
    const currentRole = device ? device.role : null;

    // Determine medium from the link that brought us here (last hop)
    const lastHop = path[path.length - 1];
    const medium = lastHop ? lastHop.medium : null;
    const linkId  = lastHop ? lastHop.link_id : null;

    const hop = {
      device_id: deviceId,
      role: currentRole,
      link_id: linkId,
      medium,
    };

    const currentPath = [...path, hop];

    // Termination: reached an edge/core device
    if (currentRole === 'core' || currentRole === 'backhaul') {
      return currentPath;
    }

    // Loop guard
    if (currentPath.length >= MAX_HOPS) {
      logger.warn({ startDeviceId, deviceId }, 'topologyContextService: max hops reached, possible loop');
      return null;
    }

    const neighbors = linksByDevice.get(deviceId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.neighborId)) {
        queue.push({
          deviceId: neighbor.neighborId,
          path: [...currentPath.slice(0, -1), { ...hop, link_id: neighbor.linkId, medium: neighbor.medium }],
        });
      }
    }
  }

  // No edge device reachable
  return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * (Re)compute and cache the topology path for a contract.
 *
 * @param {number} contractId
 * @returns {Promise<Array>}  Ordered [{device_id, role, link_id, medium}]
 */
async function buildPath(contractId) {
  logger.debug({ contractId }, 'Building topology path');

  // Load the contract and its CPE device
  const [[contractRow]] = await db.query(
    `SELECT c.id, c.organization_id,
            d.id AS cpe_device_id
     FROM contracts c
     LEFT JOIN devices d ON d.contract_id = c.id AND d.deleted_at IS NULL
     WHERE c.id = ? AND c.deleted_at IS NULL
     LIMIT 1`,
    [contractId],
  );

  if (!contractRow) {
    logger.warn({ contractId }, 'Contract not found for topology build');
    return [];
  }

  if (!contractRow.cpe_device_id) {
    logger.debug({ contractId }, 'No CPE device found for contract');
    const emptyPath = [];
    await ContractTopologyPath.upsertPath(contractId, emptyPath);
    return emptyPath;
  }

  const { deviceMap, linksByDevice } = await loadGraph(contractRow.organization_id);

  const path = traverseToEdge(contractRow.cpe_device_id, deviceMap, linksByDevice);
  const finalPath = path || [{ device_id: contractRow.cpe_device_id, role: null, link_id: null, medium: null }];

  await ContractTopologyPath.upsertPath(contractId, finalPath);
  return finalPath;
}

/**
 * Return the cached topology path for a contract, rebuilding on cache miss.
 *
 * @param {number} contractId
 * @returns {Promise<Array>}
 */
async function getPath(contractId) {
  const cached = await ContractTopologyPath.findByContractId(contractId);
  if (cached) {
    let path = cached.path;
    if (typeof path === 'string') {
      try { path = JSON.parse(path); } catch { path = []; }
    }
    return Array.isArray(path) ? path : [];
  }
  return buildPath(contractId);
}

/**
 * Return a clean context snapshot suitable for inclusion in an LLM prompt.
 *
 * @param {number} contractId
 * @returns {Promise<{cpe, accessDevice, backhauls: Array, pop, activeOutages: Array}>}
 */
async function summarize(contractId) {
  const path = await getPath(contractId);

  if (path.length === 0) {
    return { cpe: null, accessDevice: null, backhauls: [], pop: null, activeOutages: [] };
  }

  // Enrich path with device details
  const deviceIds = [...new Set(path.map(h => h.device_id).filter(Boolean))];
  let devices = [];
  if (deviceIds.length > 0) {
    const placeholders = deviceIds.map(() => '?').join(', ');
    const [rows] = await db.query(
      `SELECT id, name, type, role, status, ip_address, site_id FROM devices WHERE id IN (${placeholders})`,
      deviceIds,
    );
    devices = rows;
  }
  const deviceIndex = new Map(devices.map(d => [d.id, d]));

  const cpe         = deviceIndex.get(path[0].device_id) || null;
  const accessDevice = path.length > 1 ? (deviceIndex.get(path[1].device_id) || null) : null;
  const pop         = path.length > 1 ? (deviceIndex.get(path[path.length - 1].device_id) || null) : null;
  const backhauls   = path.slice(1, -1).map(h => ({
    device: deviceIndex.get(h.device_id) || { id: h.device_id },
    medium: h.medium,
    link_id: h.link_id,
  }));

  // Active outages for any device on the path
  let activeOutages = [];
  if (deviceIds.length > 0) {
    const placeholders = deviceIds.map(() => '?').join(', ');
    const [outageRows] = await db.query(
      `SELECT id, title, severity, start_time, device_id, site_id
       FROM outages
       WHERE status = 'active'
         AND deleted_at IS NULL
         AND device_id IN (${placeholders})`,
      deviceIds,
    );
    activeOutages = outageRows;
  }

  return { cpe, accessDevice, backhauls, pop, activeOutages };
}

/**
 * Invalidate cached path(s) when related entities change.
 *
 * @param {number} id
 * @param {'contract'|'device'|'link'} type
 * @returns {Promise<void>}
 */
async function invalidate(id, type = 'contract') {
  switch (type) {
    case 'contract':
      await ContractTopologyPath.invalidate(id);
      break;
    case 'device':
      await ContractTopologyPath.invalidateByDevice(id);
      break;
    case 'link':
      await ContractTopologyPath.invalidateByLink(id);
      break;
    default:
      logger.warn({ id, type }, 'topologyContextService.invalidate: unknown type');
  }
}

module.exports = { buildPath, getPath, summarize, invalidate };
