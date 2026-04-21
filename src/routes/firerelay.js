// =============================================================================
// FireISP 5.0 — FireRelay Routes
// =============================================================================
// /api/firerelay/* endpoints for cluster node management.
//
//   GET    /api/firerelay/health              — Worker: report node metrics
//   GET    /api/firerelay/nodes               — Master: list all nodes
//   POST   /api/firerelay/nodes               — Master: register a node
//   PUT    /api/firerelay/nodes/:id           — Master: update node status / metrics
//   DELETE /api/firerelay/nodes/:id           — Master: deregister a node
//   GET    /api/firerelay/tunnel/agents       — List connected WebSocket agents
//   POST   /api/firerelay/tunnel/command      — Send a command to a connected agent
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { firerelayNode, firerelayNodeUpdate, firerelayTunnelCommand } = require('../middleware/schemas/firerelay');
const relayConfig = require('../config/firerelay');
const db = require('../config/database');
const firerelayService = require('../services/firerelayService');
const { tunnelServer } = require('../services/firerelayTunnel');
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
router.get('/nodes', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    if (relayConfig.mode !== 'master') {
      throw new ValidationError('Node management is only available on the master node');
    }
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const result = await firerelayService.listNodes({ page: pageNum, limit: limitNum });
    res.json(result);
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
      const node = await firerelayService.registerNode(req.body);
      res.status(201).json({ data: node });
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
      const node = await firerelayService.updateNode(req.params.id, req.body);
      res.json({ data: node });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/firerelay/nodes/:id — deregister a node
// ---------------------------------------------------------------------------
router.delete(
  '/nodes/:id',
  requireRole('admin', 'owner'),
  async (req, res, next) => {
    try {
      if (relayConfig.mode !== 'master') {
        throw new ValidationError('Node management is only available on the master node');
      }
      await firerelayService.deregisterNode(req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/firerelay/tunnel/agents — list currently connected WebSocket agents
// ---------------------------------------------------------------------------
router.get('/tunnel/agents', requireRole('admin', 'owner'), (_req, res) => {
  const agents = tunnelServer.connectedAgents();
  res.json({ data: agents, meta: { total: agents.length } });
});

// ---------------------------------------------------------------------------
// POST /api/firerelay/tunnel/command — send a command to a connected agent
// ---------------------------------------------------------------------------
router.post(
  '/tunnel/command',
  requireRole('admin', 'owner'),
  validate(firerelayTunnelCommand),
  async (req, res, next) => {
    try {
      const { node_id, method, params, timeout_ms } = req.body;
      if (!tunnelServer.isConnected(node_id)) {
        throw new NotFoundError(`Agent ${node_id} is not connected`);
      }
      const result = await tunnelServer.sendCommand(node_id, method, params ?? {}, timeout_ms);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
