// =============================================================================
// FireISP 5.0 — RMA Request Routes — §14.2
// =============================================================================

const { Router } = require('express');
const RmaRequest = require('../models/RmaRequest');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRmaRequest, updateRmaRequest, shipRma, receiveRma, closeRma } = require('../middleware/schemas/rmaRequests');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(RmaRequest);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('rma.view'), ctrl.list);
router.get('/:id', requirePermission('rma.view'), ctrl.get);
router.post('/', requirePermission('rma.create'), validate(createRmaRequest), ctrl.create);
router.put('/:id', requirePermission('rma.update'), validate(updateRmaRequest), ctrl.update);
router.delete('/:id', requirePermission('rma.close'), ctrl.destroy);
router.post('/:id/restore', requirePermission('rma.update'), ctrl.restore);

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

// POST /rma-requests/:id/ship
router.post('/:id/ship', requirePermission('rma.update'), validate(shipRma), async (req, res, next) => {
  try {
    const rma = await RmaRequest.findById(parseInt(req.params.id, 10), req.orgId);
    if (!rma) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'RMA request not found' } });
    if (rma.status !== 'open') return res.status(400).json({ error: { code: 'INVALID_STATUS', message: `Cannot ship RMA in status: ${rma.status}` } });
    await db.query(
      'UPDATE rma_requests SET status = ?, shipped_at = NOW() WHERE id = ?',
      ['shipped', rma.id],
    );
    // Update linked asset lifecycle to rma
    if (rma.asset_id) {
      await db.query("UPDATE assets SET lifecycle_status = 'rma' WHERE id = ?", [rma.asset_id]);
    }
    const updated = await RmaRequest.findById(rma.id, req.orgId);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// POST /rma-requests/:id/receive
router.post('/:id/receive', requirePermission('rma.update'), validate(receiveRma), async (req, res, next) => {
  try {
    const rma = await RmaRequest.findById(parseInt(req.params.id, 10), req.orgId);
    if (!rma) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'RMA request not found' } });
    if (rma.status !== 'shipped') return res.status(400).json({ error: { code: 'INVALID_STATUS', message: `Cannot receive RMA in status: ${rma.status}` } });
    await db.query(
      'UPDATE rma_requests SET status = ?, received_at = NOW() WHERE id = ?',
      ['received', rma.id],
    );
    const updated = await RmaRequest.findById(rma.id, req.orgId);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// POST /rma-requests/:id/close
router.post('/:id/close', requirePermission('rma.close'), validate(closeRma), async (req, res, next) => {
  try {
    const rma = await RmaRequest.findById(parseInt(req.params.id, 10), req.orgId);
    if (!rma) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'RMA request not found' } });
    if (['closed', 'denied'].includes(rma.status)) {
      return res.status(400).json({ error: { code: 'ALREADY_CLOSED', message: 'RMA request is already closed or denied' } });
    }
    const { status, replacement_asset_id, notes } = req.body;
    await db.query(
      'UPDATE rma_requests SET status = ?, resolved_at = NOW(), replacement_asset_id = COALESCE(?, replacement_asset_id), notes = COALESCE(?, notes) WHERE id = ?',
      [status, replacement_asset_id || null, notes || null, rma.id],
    );
    // Restore asset lifecycle status if closed (not denied)
    if (status === 'closed' && rma.asset_id) {
      await db.query("UPDATE assets SET lifecycle_status = 'in_stock' WHERE id = ? AND lifecycle_status = 'rma'", [rma.asset_id]);
    }
    const updated = await RmaRequest.findById(rma.id, req.orgId);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

module.exports = router;
