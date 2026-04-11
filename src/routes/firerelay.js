// =============================================================================
// FireISP 5.0 — FireRelay Routes
// =============================================================================
// /api/firerelay/* endpoints for cluster node management.
//
//   GET  /api/firerelay/health      — Worker: report node metrics
//   GET  /api/firerelay/nodes       — Master: list all nodes
//   POST /api/firerelay/nodes       — Master: register a node
//   PUT  /api/firerelay/nodes/:id   — Master: update node status / metrics
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { firerelayNode, firerelayNodeUpdate } = require('../middleware/schemas/firerelay');
const relayConfig = require('../config/firerelay');
const db = require('../config/database');
const { ValidationError, NotFoundError } = require('../utils/errors');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/firerelay/health — lightweight, no auth required
// Workers expose this so the master can poll them.
// ---------------------------------------------------------------------------
router.get('/health', async (_req, res) => {
  const os = require('os');

  let clientCount = 0;
  let deviceCount = 0;
  let dbSizeMb = 0;

  try {
    const [clientRows] = await db.query('SELECT COUNT(*) AS cnt FROM clients');
    clientCount = clientRows[0].cnt;
    const [deviceRows] = await db.query('SELECT COUNT(*) AS cnt FROM devices');
    deviceCount = deviceRows[0].cnt;
    const [sizeRows] = await db.query(
      `SELECT ROUND(SUM(data_length + index_length) / 1048576) AS size_mb
       FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
    );
    dbSizeMb = sizeRows[0].size_mb || 0;
  } catch (_err) {
    // If DB is unreachable, send zeros — the master will notice via health status
  }

  res.json({
    node_id: relayConfig.nodeId || 'master',
    mode: relayConfig.mode,
    status: 'active',
    client_count: clientCount,
    device_count: deviceCount,
    cpu_percent: parseFloat((os.loadavg()[0] * 100 / os.cpus().length).toFixed(2)),
    memory_percent: parseFloat(((1 - os.freemem() / os.totalmem()) * 100).toFixed(2)),
    disk_percent: null,
    db_size_mb: dbSizeMb,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// All node-management endpoints below require admin auth
// ---------------------------------------------------------------------------
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /api/firerelay/nodes — list all registered nodes
// ---------------------------------------------------------------------------
router.get('/nodes', requireRole('admin', 'owner'), async (_req, res, next) => {
  try {
    if (relayConfig.mode !== 'master') {
      throw new ValidationError('Node management is only available on the master node');
    }
    const [rows] = await db.query(
      'SELECT * FROM firerelay_nodes ORDER BY created_at ASC',
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/firerelay/nodes — register a new node
// ---------------------------------------------------------------------------
router.post(
  '/nodes',
  requireRole('admin', 'owner'),
  validate(firerelayNode),
  async (req, res, next) => {
    try {
      if (relayConfig.mode !== 'master') {
        throw new ValidationError('Node management is only available on the master node');
      }
      const { id, name, api_url } = req.body;
      await db.query(
        `INSERT INTO firerelay_nodes (id, name, api_url, status)
         VALUES (?, ?, ?, 'active')`,
        [id, name || '', api_url],
      );
      const [rows] = await db.query('SELECT * FROM firerelay_nodes WHERE id = ?', [id]);
      res.status(201).json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/firerelay/nodes/:id — update node status or health metrics
// ---------------------------------------------------------------------------
router.put(
  '/nodes/:id',
  requireRole('admin', 'owner'),
  validate(firerelayNodeUpdate),
  async (req, res, next) => {
    try {
      if (relayConfig.mode !== 'master') {
        throw new ValidationError('Node management is only available on the master node');
      }
      const allowed = [
        'name', 'api_url', 'status',
        'client_count', 'device_count',
        'cpu_percent', 'memory_percent', 'disk_percent',
        'db_size_mb', 'uptime_seconds', 'last_seen_at',
      ];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          sets.push(`\`${key}\` = ?`);
          params.push(req.body[key]);
        }
      }
      if (sets.length === 0) {
        throw new ValidationError('No updatable fields provided');
      }
      params.push(req.params.id);
      const [result] = await db.query(
        `UPDATE firerelay_nodes SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
      if (result.affectedRows === 0) {
        throw new NotFoundError('firerelay_nodes');
      }
      const [rows] = await db.query('SELECT * FROM firerelay_nodes WHERE id = ?', [req.params.id]);
      res.json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
