// =============================================================================
// FireISP 5.0 — Asset Routes — §14.2 / §14.3
// =============================================================================

const { Router } = require('express');
const Asset = require('../models/Asset');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createAsset, updateAsset, assignAsset, disposeAsset, scanAsset } = require('../middleware/schemas/assets');
const svc = require('../services/assetService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Asset);

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Static routes BEFORE param routes
// ---------------------------------------------------------------------------

// GET /assets/stats
router.get('/stats', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const stats = await svc.getStats(req.orgId);
    res.json({ data: stats });
  } catch (err) { next(err); }
});

// GET /assets/low-stock
router.get('/low-stock', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const items = await svc.getLowStockItems(req.orgId);
    res.json({ data: items });
  } catch (err) { next(err); }
});

// POST /assets/scan — lookup by barcode
router.post('/scan', requirePermission('assets.scan'), validate(scanAsset), async (req, res, next) => {
  try {
    const asset = await svc.findByBarcode(req.orgId, req.body.barcode);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No asset found with that barcode' } });
    res.json({ data: asset });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

router.get('/', requirePermission('assets.view'), ctrl.list);
router.get('/:id', requirePermission('assets.view'), ctrl.get);
router.post('/', requirePermission('assets.create'), validate(createAsset), ctrl.create);
router.put('/:id', requirePermission('assets.update'), validate(updateAsset), ctrl.update);
router.delete('/:id', requirePermission('assets.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('assets.update'), ctrl.restore);

// ---------------------------------------------------------------------------
// Asset-specific operations
// ---------------------------------------------------------------------------

// GET /assets/:id/barcode
router.get('/:id/barcode', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    const barcode = svc.generateBarcode(asset);
    res.json({ data: barcode });
  } catch (err) { next(err); }
});

// GET /assets/:id/depreciation
router.get('/:id/depreciation', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    const depreciation = svc.calculateDepreciation(asset);
    res.json({ data: depreciation });
  } catch (err) { next(err); }
});

// GET /assets/:id/assignments
router.get('/:id/assignments', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    const assignments = await Asset.getAssignments(asset.id, req.orgId);
    res.json({ data: assignments });
  } catch (err) { next(err); }
});

// GET /assets/:id/rma
router.get('/:id/rma', requirePermission('assets.view'), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    const rmaList = await Asset.getRmaRequests(asset.id, req.orgId);
    res.json({ data: rmaList });
  } catch (err) { next(err); }
});

// POST /assets/:id/assign
router.post('/:id/assign', requirePermission('assets.assign'), validate(assignAsset), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    if (asset.lifecycle_status === 'disposed') {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Cannot assign a disposed asset' } });
    }
    const { client_id, device_id, port_name, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO asset_assignments (asset_id, organization_id, client_id, device_id, port_name, assigned_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [asset.id, req.orgId, client_id || null, device_id || null, port_name || null, req.user?.id || null, notes || null],
    );
    await db.query('UPDATE assets SET lifecycle_status = ? WHERE id = ?', ['assigned', asset.id]);
    const [rows] = await db.query('SELECT * FROM asset_assignments WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /assets/:id/unassign
router.post('/:id/unassign', requirePermission('assets.assign'), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    // Close the latest open assignment
    await db.query(
      `UPDATE asset_assignments
       SET returned_at = NOW(), returned_by = ?
       WHERE asset_id = ? AND organization_id = ? AND returned_at IS NULL
       ORDER BY assigned_at DESC
       LIMIT 1`,
      [req.user?.id || null, asset.id, req.orgId],
    );
    await db.query('UPDATE assets SET lifecycle_status = ? WHERE id = ?', ['in_stock', asset.id]);
    const updated = await Asset.findById(asset.id, req.orgId);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// POST /assets/:id/swap — swap asset to a new assignment (unassign current, assign new)
router.post('/:id/swap', requirePermission('assets.assign'), validate(assignAsset), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    // Close existing open assignment
    await db.query(
      `UPDATE asset_assignments
       SET returned_at = NOW(), returned_by = ?
       WHERE asset_id = ? AND organization_id = ? AND returned_at IS NULL`,
      [req.user?.id || null, asset.id, req.orgId],
    );
    // Create new assignment
    const { client_id, device_id, port_name, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO asset_assignments (asset_id, organization_id, client_id, device_id, port_name, assigned_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [asset.id, req.orgId, client_id || null, device_id || null, port_name || null, req.user?.id || null, notes || null],
    );
    await db.query('UPDATE assets SET lifecycle_status = ? WHERE id = ?', ['assigned', asset.id]);
    const [rows] = await db.query('SELECT * FROM asset_assignments WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /assets/:id/dispose
router.post('/:id/dispose', requirePermission('assets.dispose'), validate(disposeAsset), async (req, res, next) => {
  try {
    const asset = await Asset.findById(parseInt(req.params.id, 10), req.orgId);
    if (!asset) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    if (asset.lifecycle_status === 'disposed') {
      return res.status(400).json({ error: { code: 'ALREADY_DISPOSED', message: 'Asset is already disposed' } });
    }
    const { disposal_reason, disposal_notes } = req.body;
    await db.query(
      'UPDATE assets SET lifecycle_status = ?, disposed_at = NOW(), disposal_reason = ?, disposal_notes = ? WHERE id = ?',
      ['disposed', disposal_reason, disposal_notes || null, asset.id],
    );
    const updated = await Asset.findById(asset.id, req.orgId);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

module.exports = router;
