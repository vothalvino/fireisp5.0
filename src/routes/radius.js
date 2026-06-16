// =============================================================================
// FireISP 5.0 — RADIUS Routes
// =============================================================================

const { Router } = require('express');
const Radius = require('../models/Radius');
const Nas = require('../models/Nas');
const routerProvisioningService = require('../services/routerProvisioningService');
const { ValidationError } = require('../utils/errors');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRadius, updateRadius } = require('../middleware/schemas/radius');
const {
  disconnectSession,
  syncFreeradiusTables,
  kickDuplicateSessions,
} = require('../services/radiusService');
const { createRoute, updateWalledGarden } = require('../middleware/schemas/radius');
const db = require('../config/database');
const { exportCdr, listMacMoveEvents } = require('../services/radiusAccountingService');
const { sendRadiusPacket } = require('../services/suspensionService');
const radiusServerService = require('../services/radiusServerService');
const auditLog = require('../services/auditLog');

const router = Router();
const ctrl = crudController(Radius);

router.use(authenticate);
router.use(orgScope);

// -----------------------------------------------------------------------------
// Embedded RADIUS server status (auth/accounting counters, ports, running state).
// Literal path — registered before the generic `/:id` CRUD route.
// -----------------------------------------------------------------------------
router.get('/server-status', requirePermission('devices.view'), (_req, res) => {
  res.json({ data: radiusServerService.getStatus() });
});

// -----------------------------------------------------------------------------
// MAC Move Events (item 21)
// -----------------------------------------------------------------------------
// NOTE: this literal-path route MUST be registered before the generic `/:id`
// CRUD route below, otherwise Express matches `/mac-move-events` as `/:id`
// (id = "mac-move-events"), findByIdOrFail fails, and the request 404s.
router.get('/mac-move-events', requirePermission('radius.mac_move_events.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const result = await listMacMoveEvents(req.orgId, { page, limit });
    res.json({
      data: result.rows,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (err) {
    next(err);
  }
});

// Get RADIUS accounts for a specific contract
router.get('/contract/:contractId', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const accounts = await Radius.findByContract(req.params.contractId);
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// Manually trigger FreeRADIUS SQL table sync for this org
router.post('/sync-freeradius', requirePermission('radius.sync'), async (req, res, next) => {
  try {
    const result = await syncFreeradiusTables(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Disconnect a subscriber's active PPPoE session via RADIUS Disconnect-Request
router.post('/:id/disconnect', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT contract_id FROM radius WHERE id = ?',
      [req.params.id],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'RADIUS account not found' });
    }
    const result = await disconnectSession(rows[0].contract_id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Direct RouterOS provisioning — push a subscriber (PPPoE secret) to its NAS
// =============================================================================
// Placed with the other `/:id/...` item routes (above the generic `/:id` CRUD
// block) so it stays tidy alongside `/:id/disconnect` and `/:id/routes`.
router.post('/:id/push', requirePermission('radius.sync'), async (req, res, next) => {
  try {
    const radius = await Radius.findByIdOrFail(req.params.id, req.orgId);

    if (!radius.nas_id) {
      return res.status(422).json({ error: { code: 'NO_NAS', message: 'Subscriber has no NAS assigned' } });
    }

    const nas = await Nas.findByIdOrFail(radius.nas_id, req.orgId);

    const sub = {
      username: radius.username,
      password: radius.password,
      profile: radius.profile,
      comment: 'FireISP radius#' + radius.id + ' client#' + radius.client_id + ' contract#' + radius.contract_id,
    };

    try {
      res.json({ data: await routerProvisioningService.pushSubscriber(nas, sub) });
    } catch (e) {
      // Misconfiguration (e.g. NAS missing API username) is a 422, not "unreachable".
      if (e instanceof ValidationError || e.statusCode === 422) return next(e);
      res.status(502).json({ error: { code: 'ROUTER_UNREACHABLE', message: e.message } });
    }
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Per-account route injection CRUD (item 15 — Framed-Route)
// =============================================================================

router.get('/:id/routes', requirePermission('radius_account_routes.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM radius_account_routes WHERE radius_account_id = ? AND deleted_at IS NULL ORDER BY id ASC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/routes', requirePermission('radius_account_routes.create'), validate(createRoute), async (req, res, next) => {
  try {
    const { destination, gateway, metric } = req.body;
    const [result] = await db.query(
      `INSERT INTO radius_account_routes (radius_account_id, organization_id, destination, gateway, metric)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.orgId, destination, gateway ?? null, metric ?? null],
    );
    const [rows] = await db.query('SELECT * FROM radius_account_routes WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/routes/:routeId', requirePermission('radius_account_routes.update'), validate(createRoute), async (req, res, next) => {
  try {
    const { destination, gateway, metric } = req.body;
    await db.query(
      `UPDATE radius_account_routes SET destination=?, gateway=?, metric=?
       WHERE id = ? AND radius_account_id = ? AND deleted_at IS NULL`,
      [destination, gateway ?? null, metric ?? null, req.params.routeId, req.params.id],
    );
    const [rows] = await db.query('SELECT * FROM radius_account_routes WHERE id = ?', [req.params.routeId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/routes/:routeId', requirePermission('radius_account_routes.delete'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE radius_account_routes SET deleted_at = NOW() WHERE id = ? AND radius_account_id = ? AND deleted_at IS NULL',
      [req.params.routeId, req.params.id],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Walled Garden Settings (item 14)
// =============================================================================

router.get('/walled-garden', requirePermission('walled_garden.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM organization_walled_garden_settings WHERE organization_id = ?',
      [req.orgId],
    );
    res.json({ data: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.put('/walled-garden', requirePermission('walled_garden.update'), validate(updateWalledGarden), async (req, res, next) => {
  try {
    const { enabled, redirect_url, address_list_name, allowed_destinations } = req.body;
    await db.query(
      `INSERT INTO organization_walled_garden_settings
           (organization_id, enabled, redirect_url, address_list_name, allowed_destinations)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         redirect_url = VALUES(redirect_url),
         address_list_name = VALUES(address_list_name),
         allowed_destinations = VALUES(allowed_destinations)`,
      [req.orgId, enabled ? 1 : 0, redirect_url ?? null,
        address_list_name ?? 'walled_garden', allowed_destinations ?? null],
    );
    const [rows] = await db.query(
      'SELECT * FROM organization_walled_garden_settings WHERE organization_id = ?',
      [req.orgId],
    );
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Manual duplicate-session kick (item 11)
// =============================================================================

router.post('/kick-sessions', requirePermission('radius.kick_sessions'), async (req, res, next) => {
  try {
    const result = await kickDuplicateSessions(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// CDR Export (item 20)
// =============================================================================

router.get('/cdr', requirePermission('radius.cdr_export'), async (req, res, next) => {
  try {
    const { from, to, username, format = 'json' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Query params "from" and "to" are required (ISO date strings)' });
    }

    const result = await exportCdr({
      from,
      to,
      username: username || null,
      format,
      organizationId: req.orgId,
    });

    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'export',
      tableName: 'connection_logs',
      recordId: 0,
      newValues: { from, to, username: username || null, format },
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=cdr_export.csv');
      return res.send(result.csv);
    }

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Dynamic CoA (items 24, 25, 26)
// =============================================================================

router.post('/coa', requirePermission('radius.coa'), async (req, res, next) => {
  try {
    const { username, attributes = [] } = req.body;

    if (!username) {
      return res.status(400).json({ error: '"username" is required' });
    }

    const [rows] = await db.query(
      // Scope by the NAS's organization — the radius table has no
      // organization_id column (Radius.hasOrgScope === false).
      `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret, n.secondary_nas_id
       FROM radius r
       JOIN nas n ON n.id = r.nas_id
       WHERE r.username = ? AND n.organization_id = ?
       LIMIT 1`,
      [username, req.orgId],
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'RADIUS account not found' });
    }

    const nas = rows[0];

    if (!nas.secret) {
      return res.status(422).json({ error: 'NAS RADIUS secret is not configured' });
    }

    // sendRadiusPacket handles User-Name + encoder + authenticator internally
    let result = await sendRadiusPacket(nas.nas_ip, nas.coa_port || 3799, nas.secret, 43, nas.username, attributes);

    if (!result.sent && nas.secondary_nas_id) {
      const [secRows] = await db.query(
        'SELECT ip_address, coa_port, secret FROM nas WHERE id = ? LIMIT 1',
        [nas.secondary_nas_id],
      );
      if (secRows.length > 0) {
        const sec = secRows[0];
        result = await sendRadiusPacket(sec.ip_address, sec.coa_port || 3799, sec.secret, 43, nas.username, attributes);
      }
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Batch force-disconnect (PPPoE Management Phase A)
// =============================================================================

router.post('/sessions/disconnect-batch', requirePermission('radius.batch_disconnect'), async (req, res, next) => {
  try {
    const { acct_session_ids, usernames } = req.body;

    if (!acct_session_ids && !usernames) {
      return res.status(400).json({ error: 'Provide acct_session_ids or usernames' });
    }

    const ids = acct_session_ids || [];
    const names = usernames || [];
    const totalCount = ids.length + names.length;

    if (totalCount > 100) {
      return res.status(400).json({ error: 'Maximum 100 sessions per batch' });
    }
    if (totalCount === 0) {
      return res.status(400).json({ error: 'At least one session identifier required' });
    }

    const results = [];

    // Disconnect by acct_session_ids (session_id values in connection_logs)
    for (const sessionId of ids) {
      const [rows] = await db.query(
        `SELECT DISTINCT cl.contract_id FROM connection_logs cl
         WHERE cl.session_id = ? AND cl.event_type = 'start'
           AND NOT EXISTS (
             SELECT 1 FROM connection_logs cl2
             WHERE cl2.session_id = cl.session_id
               AND cl2.contract_id = cl.contract_id
               AND cl2.event_type = 'stop'
           )
         LIMIT 1`,
        [sessionId],
      );
      if (!rows.length) {
        results.push({ session_id: sessionId, success: false, error: 'Session not found or already stopped' });
        continue;
      }
      try {
        await disconnectSession(rows[0].contract_id);
        await auditLog.log({
          userId: req.user.id,
          organizationId: req.orgId,
          action: 'disconnect',
          tableName: 'connection_logs',
          recordId: rows[0].contract_id,
          newValues: { session_id: sessionId, initiated_by: 'batch_disconnect' },
        });
        results.push({ session_id: sessionId, success: true });
      } catch (err) {
        results.push({ session_id: sessionId, success: false, error: err.message });
      }
    }

    // Disconnect by usernames
    for (const username of names) {
      const [rows] = await db.query(
        'SELECT contract_id FROM radius WHERE username = ? LIMIT 1',
        [username],
      );
      if (!rows.length) {
        results.push({ username, success: false, error: 'RADIUS account not found' });
        continue;
      }
      try {
        await disconnectSession(rows[0].contract_id);
        await auditLog.log({
          userId: req.user.id,
          organizationId: req.orgId,
          action: 'disconnect',
          tableName: 'radius',
          recordId: rows[0].contract_id,
          newValues: { username, initiated_by: 'batch_disconnect' },
        });
        results.push({ username, success: true });
      } catch (err) {
        results.push({ username, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    res.json({
      data: results,
      meta: { total: results.length, succeeded, failed: results.length - succeeded },
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Generic CRUD — registered LAST so every literal-path route above
// (/mac-move-events, /walled-garden, /cdr, /contract/:id, /:id/routes, …) is
// matched before the bare `/:id` param route. Otherwise Express would treat
// e.g. GET /walled-garden as `/:id` (id = "walled-garden"), findByIdOrFail
// would fail, and the request would 404.
// -----------------------------------------------------------------------------
router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createRadius), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateRadius), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

module.exports = router;
