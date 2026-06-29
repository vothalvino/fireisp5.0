// =============================================================================
// FireISP 5.0 — Plan Routes
// =============================================================================

const { Router } = require('express');
const Plan = require('../models/Plan');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPlan, updatePlan, patchPlan, createPlanAddon, createSpeedWindow, createAccessWindow } = require('../middleware/schemas/plans');
const { httpCache } = require('../middleware/httpCache');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Plan, { cacheResource: 'plans' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('plans.view'), httpCache('plans', 300), ctrl.list);
router.get('/:id', requirePermission('plans.view'), ctrl.get);
router.post('/', requirePermission('plans.create'), validate(createPlan), async (req, res, next) => {
  // Default currency to the org's currency when the client omits it.
  if (!req.body.currency && req.orgId) {
    req.body.currency = await Organization.getCurrency(req.orgId);
  }
  return ctrl.create(req, res, next);
});
router.put('/:id', requirePermission('plans.update'), validate(updatePlan), ctrl.update);
router.patch('/:id', requirePermission('plans.update'), validate(patchPlan), ctrl.partialUpdate);
router.delete('/:id', requirePermission('plans.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('plans.update'), ctrl.restore);

// Plan add-ons
router.get('/addons/catalog', requirePermission('plans.view'), async (req, res, next) => {
  try {
    const addons = await Plan.getAddons(req.orgId);
    res.json({ data: addons });
  } catch (err) {
    next(err);
  }
});

router.post('/addons', requirePermission('plans.create'), validate(createPlanAddon), async (req, res, next) => {
  try {
    const { name, addon_type, price, billing_cycle, taxable, status } = req.body;
    const [result] = await db.query(
      `INSERT INTO plan_addons (organization_id, name, addon_type, price, billing_cycle, taxable, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, addon_type, price, billing_cycle, taxable !== false, status || 'active'],
    );
    const [rows] = await db.query('SELECT * FROM plan_addons WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

const { generateAttributes } = require('../services/radiusAttributeService');

// RADIUS attributes preview
router.get('/:id/radius-attributes', requirePermission('plans.view'), async (req, res, next) => {
  try {
    const plan = await Plan.findById(req.params.id, req.orgId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const attributes = generateAttributes(plan);
    res.json({ data: { plan_id: plan.id, vendor: plan.radius_vendor || 'generic', attributes } });
  } catch (err) {
    next(err);
  }
});

// Speed windows CRUD
router.get('/:id/speed-windows', requirePermission('plans.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM plan_speed_windows WHERE plan_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY priority ASC, id ASC',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/speed-windows', requirePermission('plans.create'), validate(createSpeedWindow), async (req, res, next) => {
  try {
    const { label, day_mask, start_time, end_time, download_speed_mbps, upload_speed_mbps, priority, status } = req.body;
    const [result] = await db.query(
      `INSERT INTO plan_speed_windows (plan_id, organization_id, label, day_mask, start_time, end_time, download_speed_mbps, upload_speed_mbps, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.orgId, label, day_mask ?? 127, start_time, end_time, download_speed_mbps, upload_speed_mbps, priority ?? 10, status ?? 'active'],
    );
    const [rows] = await db.query('SELECT * FROM plan_speed_windows WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/speed-windows/:windowId', requirePermission('plans.update'), validate(createSpeedWindow), async (req, res, next) => {
  try {
    const { label, day_mask, start_time, end_time, download_speed_mbps, upload_speed_mbps, priority, status } = req.body;
    await db.query(
      `UPDATE plan_speed_windows SET label=?, day_mask=?, start_time=?, end_time=?, download_speed_mbps=?, upload_speed_mbps=?, priority=?, status=?
       WHERE id = ? AND plan_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [label, day_mask ?? 127, start_time, end_time, download_speed_mbps, upload_speed_mbps, priority ?? 10, status ?? 'active',
        req.params.windowId, req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM plan_speed_windows WHERE id = ?', [req.params.windowId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Speed window not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/speed-windows/:windowId', requirePermission('plans.update'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE plan_speed_windows SET deleted_at = NOW() WHERE id = ? AND plan_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.windowId, req.params.id, req.orgId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Access Windows CRUD (item 12 — time-based access restriction)
// =============================================================================

router.get('/:id/access-windows', requirePermission('plan_access_windows.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM plan_access_windows WHERE plan_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY id ASC',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/access-windows', requirePermission('plan_access_windows.create'), validate(createAccessWindow), async (req, res, next) => {
  try {
    const { label, day_mask, start_time, end_time, status } = req.body;
    const [result] = await db.query(
      `INSERT INTO plan_access_windows (plan_id, organization_id, label, day_mask, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.orgId, label, day_mask ?? 127, start_time, end_time, status ?? 'active'],
    );
    const [rows] = await db.query('SELECT * FROM plan_access_windows WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/access-windows/:windowId', requirePermission('plan_access_windows.update'), validate(createAccessWindow), async (req, res, next) => {
  try {
    const { label, day_mask, start_time, end_time, status } = req.body;
    await db.query(
      `UPDATE plan_access_windows SET label=?, day_mask=?, start_time=?, end_time=?, status=?
       WHERE id = ? AND plan_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [label, day_mask ?? 127, start_time, end_time, status ?? 'active',
        req.params.windowId, req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM plan_access_windows WHERE id = ?', [req.params.windowId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Access window not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/access-windows/:windowId', requirePermission('plan_access_windows.delete'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE plan_access_windows SET deleted_at = NOW() WHERE id = ? AND plan_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.windowId, req.params.id, req.orgId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
