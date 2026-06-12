// =============================================================================
// FireISP 5.0 — Data Management Routes (§10.3)
// =============================================================================
// Covers: data packs catalog, subscriber pack purchases, rollover balances,
//         and FUP usage notification management.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createDataPack, updateDataPack } = require('../middleware/schemas/dataPacks');
const dataPackService = require('../services/dataPackService');
const rolloverService = require('../services/rolloverService');
const fupNotificationService = require('../services/fupNotificationService');

const router = Router();

router.use(['/data-packs', '/data-pack-purchases', '/contracts', '/rollover', '/fup'], authenticate, orgScope);

// ---------------------------------------------------------------------------
// Data Pack Catalog
// ---------------------------------------------------------------------------

// GET /data-packs
router.get('/data-packs', requirePermission('data_packs.view'), async (req, res, next) => {
  try {
    const rows = await dataPackService.listPacks(req.orgId);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /data-packs
router.post('/data-packs', requirePermission('data_packs.create'), validate(createDataPack), async (req, res, next) => {
  try {
    const pack = await dataPackService.createPack(req.orgId, req.body);
    res.status(201).json({ data: pack });
  } catch (err) {
    next(err);
  }
});

// PUT /data-packs/:id
router.put('/data-packs/:id', requirePermission('data_packs.update'), validate(updateDataPack), async (req, res, next) => {
  try {
    const pack = await dataPackService.updatePack(req.params.id, req.orgId, req.body);
    if (!pack) return res.status(404).json({ error: 'Data pack not found' });
    res.json({ data: pack });
  } catch (err) {
    next(err);
  }
});

// DELETE /data-packs/:id
router.delete('/data-packs/:id', requirePermission('data_packs.delete'), async (req, res, next) => {
  try {
    await dataPackService.deletePack(req.params.id, req.orgId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /data-packs/:id/restore
router.post('/data-packs/:id/restore', requirePermission('data_packs.update'), async (req, res, next) => {
  try {
    const pack = await dataPackService.restorePack(req.params.id, req.orgId);
    res.json({ data: pack });
  } catch (err) {
    next(err);
  }
});

// GET /data-packs/:id/purchases
router.get('/data-packs/:id/purchases', requirePermission('data_pack_purchases.view'), async (req, res, next) => {
  try {
    const rows = await dataPackService.listPackPurchases(req.params.id, req.orgId);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Contract-scoped data pack endpoints
// ---------------------------------------------------------------------------

// GET /contracts/:contractId/data-packs — effective allowance + purchases
router.get('/contracts/:contractId/data-packs', requirePermission('data_pack_purchases.view'), async (req, res, next) => {
  try {
    const [allowance, purchases] = await Promise.all([
      dataPackService.getEffectiveAllowance(req.params.contractId),
      dataPackService.listPurchases(req.orgId, req.params.contractId),
    ]);
    res.json({ data: { allowance, purchases } });
  } catch (err) {
    next(err);
  }
});

// POST /contracts/:contractId/data-packs/:packId/purchase — admin purchase
router.post('/contracts/:contractId/data-packs/:packId/purchase', requirePermission('data_pack_purchases.create'), async (req, res, next) => {
  try {
    const purchase = await dataPackService.purchasePack(
      req.orgId,
      req.params.contractId,
      req.params.packId,
      { purchasedBy: 'admin', invoiceId: req.body.invoice_id || null },
    );
    res.status(201).json({ data: purchase });
  } catch (err) {
    next(err);
  }
});

// PUT /data-pack-purchases/:id/cancel
router.put('/data-pack-purchases/:id/cancel', requirePermission('data_pack_purchases.create'), async (req, res, next) => {
  try {
    const purchase = await dataPackService.cancelPurchase(req.params.id, req.orgId);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json({ data: purchase });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Rollover Balances
// ---------------------------------------------------------------------------

// GET /contracts/:contractId/rollover
router.get('/contracts/:contractId/rollover', requirePermission('data_rollover.view'), async (req, res, next) => {
  try {
    const balance = await rolloverService.getRolloverBalance(req.params.contractId);
    res.json({ data: balance });
  } catch (err) {
    next(err);
  }
});

// POST /rollover/accrue — manual trigger
router.post('/rollover/accrue', requirePermission('data_rollover.manage'), async (req, res, next) => {
  try {
    const result = await rolloverService.accrueRollover(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// FUP Notifications
// ---------------------------------------------------------------------------

// GET /fup/notifications
router.get('/fup/notifications', requirePermission('data_packs.view'), async (req, res, next) => {
  try {
    const { contract_id, month } = req.query;
    const rows = await fupNotificationService.listNotifications(req.orgId, {
      contractId: contract_id || undefined,
      month: month || undefined,
    });
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /fup/check-thresholds — manual trigger
router.post('/fup/check-thresholds', requirePermission('data_rollover.manage'), async (req, res, next) => {
  try {
    const result = await fupNotificationService.checkAndNotifyThresholds(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
