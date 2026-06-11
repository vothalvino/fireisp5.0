// =============================================================================
// FireISP 5.0 — RADIUS Routes
// =============================================================================

const { Router } = require('express');
const Radius = require('../models/Radius');
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

const router = Router();
const ctrl = crudController(Radius);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createRadius), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateRadius), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

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

module.exports = router;
