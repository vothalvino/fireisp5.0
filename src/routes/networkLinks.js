// =============================================================================
// FireISP 5.0 — Network Link Routes
// =============================================================================

const { Router } = require('express');
const NetworkLink = require('../models/NetworkLink');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createNetworkLink, updateNetworkLink } = require('../middleware/schemas/networkLinks');
const topologyContextService = require('../services/topologyContextService');
const logger = require('../utils/logger').child({ service: 'routes/networkLinks' });

const router = Router();
const ctrl = crudController(NetworkLink);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('network_links.view'), ctrl.list);
router.get('/:id', requirePermission('network_links.view'), ctrl.get);
router.post('/', requirePermission('network_links.create'), validate(createNetworkLink), async (req, res, next) => {
  try {
    if (NetworkLink.hasOrgScope && req.orgId) req.body.organization_id = req.orgId;
    const record = await NetworkLink.create(req.body);
    topologyContextService.invalidate(record.id, 'link')
      .catch(err => logger.warn({ err: err.message, linkId: record.id }, 'topology invalidate failed on link create'));
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});
router.put('/:id', requirePermission('network_links.update'), validate(updateNetworkLink), async (req, res, next) => {
  try {
    const record = await NetworkLink.update(req.params.id, req.body, req.orgId);
    topologyContextService.invalidate(record.id, 'link')
      .catch(err => logger.warn({ err: err.message, linkId: record.id }, 'topology invalidate failed on link update'));
    res.json({ data: record });
  } catch (err) { next(err); }
});
router.delete('/:id', requirePermission('network_links.delete'), async (req, res, next) => {
  try {
    const old = await NetworkLink.findByIdOrFail(req.params.id, req.orgId);
    await NetworkLink.delete(req.params.id, req.orgId);
    topologyContextService.invalidate(old.id, 'link')
      .catch(err => logger.warn({ err: err.message, linkId: old.id }, 'topology invalidate failed on link delete'));
    res.status(204).send();
  } catch (err) { next(err); }
});
router.post('/:id/restore', requirePermission('network_links.update'), async (req, res, next) => {
  try {
    const record = await NetworkLink.restore(req.params.id, req.orgId);
    topologyContextService.invalidate(record.id, 'link')
      .catch(err => logger.warn({ err: err.message, linkId: record.id }, 'topology invalidate failed on link restore'));
    res.json({ data: record });
  } catch (err) { next(err); }
});

module.exports = router;
