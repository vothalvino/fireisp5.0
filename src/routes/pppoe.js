// =============================================================================
// FireISP 5.0 — PPPoE Diagnostics + Event Ingest Routes
// =============================================================================
// Mixed-auth router:
//   - POST /events: machine-to-machine shared-secret auth (no JWT)
//   - GET  /events, /diagnostics/*: JWT authenticate + orgScope + requirePermission
// =============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validatePppoeEvent } = require('../middleware/validatePppoeEvent');
const pppoeDiagnosticsService = require('../services/pppoeDiagnosticsService');
const pppoeReadinessService = require('../services/pppoeReadinessService');
const { deriveEventIdentity } = require('../services/pppoeEventCollector');
const { ValidationError } = require('../utils/errors');
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
  const authHeader = req.headers['authorization'];
  const expectedBuffer = Buffer.from(String(secret));
  const candidates = [
    headerSecret,
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null,
  ];
  return candidates.some((candidate) => {
    if (!candidate) return false;
    const providedBuffer = Buffer.from(String(candidate));
    return expectedBuffer.length === providedBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  });
}

function requireEventsSecret(req, res, next) {
  if (!verifyEventsSecret(req)) {
    return res.status(401).json({ error: 'Invalid or missing X-Pppoe-Secret' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /pppoe/events — M2M event log ingest (no JWT required)
// ---------------------------------------------------------------------------

router.post('/events', requireEventsSecret, validatePppoeEvent, async (req, res, next) => {
  try {
    const { nas_id: nasId } = req.body;
    const [nasRows] = await db.query(
      `SELECT n.id, n.organization_id
         FROM nas n
        WHERE n.id = ?
          AND n.status = 'active'
          AND n.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM organization_database_configs odc
             WHERE odc.organization_id = n.organization_id
               AND odc.isolation_mode = 'isolated'
          )
        LIMIT 1`,
      [nasId],
    );
    const nas = nasRows[0];
    if (!nas || nas.organization_id === null) {
      throw new ValidationError('Validation failed', [
        { field: 'nas_id', message: 'nas_id does not identify an active tenant-owned NAS record' },
      ]);
    }

    const message = req.body.line || req.body.message;
    const parsed = pppoeDiagnosticsService.parseRouterOsLogLine(message);
    const identity = deriveEventIdentity(message);
    const data = {
      // Never accept organization_id from the M2M caller. NAS ownership is the
      // only tenant authority for this unauthenticated-by-JWT endpoint.
      organization_id: nas.organization_id,
      nas_id: nas.id,
      username: req.body.username || identity.username || null,
      mac: req.body.mac || identity.mac || null,
      stage: req.body.stage || parsed?.stage || 'OTHER',
      severity: req.body.severity || parsed?.severity || 'info',
      message,
      reason_code: req.body.reason_code || parsed?.reason_code || null,
    };
    // Omit the column entirely when the caller supplies no timestamp so the DB
    // DEFAULT CURRENT_TIMESTAMP is used. Explicit NULL violates the NOT NULL
    // column and bypasses the intended default.
    if (req.body.logged_at !== undefined) data.logged_at = req.body.logged_at;

    const record = await PppoeEventLog.create(data);

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

// GET /pppoe/diagnostics/readiness — telemetry source health for the UI banner
router.get('/diagnostics/readiness', requirePermission('pppoe.diagnostics'), async (req, res, next) => {
  try {
    res.json({ data: await pppoeReadinessService.getReadiness(req.orgId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
