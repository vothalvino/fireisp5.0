// =============================================================================
// FireISP 5.0 — PPPoE Diagnostics + Event Ingest Routes
// =============================================================================
// Mixed-auth router:
//   - POST /events: machine-to-machine shared-secret auth (no JWT)
//   - GET  /events, /diagnostics/*: JWT authenticate + orgScope + requirePermission
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const pppoeDiagnosticsService = require('../services/pppoeDiagnosticsService');
const PppoeEventLog = require('../models/PppoeEventLog');

const router = Router();

// ---------------------------------------------------------------------------
// Machine-to-machine secret auth helper
// ---------------------------------------------------------------------------

/**
 * Verify the shared secret for M2M event ingest.
 * Checks X-Pppoe-Secret header or Authorization: Bearer <secret>.
 */
function verifyEventsSecret(req) {
  const secret = process.env.PPPOE_EVENTS_SECRET || process.env.RADIUS_ACCOUNTING_SECRET;
  if (!secret) return false;

  const headerSecret = req.headers['x-pppoe-secret'];
  if (headerSecret && headerSecret === secret) return true;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === secret) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// POST /pppoe/events — M2M event log ingest (no JWT required)
// ---------------------------------------------------------------------------

router.post('/events', async (req, res, next) => {
  try {
    if (!verifyEventsSecret(req)) {
      return res.status(401).json({ error: 'Invalid or missing X-Pppoe-Secret' });
    }

    const {
      organization_id, nas_id, username, mac, stage, severity,
      message, reason_code, logged_at,
    } = req.body;

    if (!message) {
      return res.status(422).json({ error: 'message is required' });
    }

    const record = await PppoeEventLog.create({
      organization_id: organization_id || null,
      nas_id: nas_id || null,
      username: username || null,
      mac: mac || null,
      stage: stage || 'OTHER',
      severity: severity || 'info',
      message,
      reason_code: reason_code || null,
      logged_at: logged_at || null,
    });

    return res.status(201).json({ data: record });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Authenticated routes (JWT + orgScope) — must come after the M2M POST
// ---------------------------------------------------------------------------

router.use(authenticate);
router.use(orgScope);

// GET /pppoe/events — list event logs with filters
router.get('/events', requirePermission('pppoe.diagnostics'), async (req, res, next) => {
  try {
    const {
      from, to, username, mac, stage, severity,
      page = 1, limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = `
      SELECT * FROM pppoe_event_logs
      WHERE organization_id = ?
    `;
    const params = [req.orgId];

    if (from) { sql += ' AND logged_at >= ?'; params.push(from); }
    if (to) { sql += ' AND logged_at <= ?'; params.push(to); }
    if (username) { sql += ' AND username = ?'; params.push(username); }
    if (mac) { sql += ' AND mac = ?'; params.push(mac); }
    if (stage) { sql += ' AND stage = ?'; params.push(stage); }
    if (severity) { sql += ' AND severity = ?'; params.push(severity); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY logged_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /pppoe/diagnostics/auth-failures
router.get('/diagnostics/auth-failures', requirePermission('pppoe.diagnostics'), async (req, res, next) => {
  try {
    const { from, to, username } = req.query;
    const result = await pppoeDiagnosticsService.classifyAuthFailures(
      req.orgId,
      from || null,
      to || null,
      username || null,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /pppoe/diagnostics/mtu-issues
router.get('/diagnostics/mtu-issues', requirePermission('pppoe.diagnostics'), async (req, res, next) => {
  try {
    const result = await pppoeDiagnosticsService.detectMtuIssues(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
