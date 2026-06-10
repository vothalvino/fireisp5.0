// =============================================================================
// FireISP 5.0 — Win-back Campaign Routes — §1.2
// =============================================================================

const { Router } = require('express');
const WinbackCampaign = require('../models/WinbackCampaign');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createWinbackCampaign, updateWinbackCampaign, patchWinbackCampaign } = require('../middleware/schemas/winbackCampaigns');
const lifecycleService = require('../services/lifecycleService');

const router = Router();
const ctrl = crudController(WinbackCampaign, { cacheResource: 'winback-campaigns' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('winback.view'), ctrl.list);
router.get('/:id', requirePermission('winback.view'), ctrl.get);
router.post('/', requirePermission('winback.create'), validate(createWinbackCampaign), ctrl.create);
router.put('/:id', requirePermission('winback.update'), validate(updateWinbackCampaign), ctrl.update);
router.patch('/:id', requirePermission('winback.update'), validate(patchWinbackCampaign), ctrl.partialUpdate);
router.delete('/:id', requirePermission('winback.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('winback.update'), ctrl.restore);

// Preview the cancelled-customer cohort this campaign would target.
router.get('/:id/targets', requirePermission('winback.view'), async (req, res, next) => {
  try {
    const campaign = await WinbackCampaign.findByIdOrFail(req.params.id, req.orgId);
    const targets = await lifecycleService.winbackTargets(campaign.target_segment, req.orgId);
    res.json({ data: targets, meta: { count: targets.length, segment: campaign.target_segment } });
  } catch (err) { next(err); }
});

module.exports = router;
