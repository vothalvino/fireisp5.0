// =============================================================================
// FireISP 5.0 — Webhook Routes
// =============================================================================

const { Router } = require('express');
const Webhook = require('../models/Webhook');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createWebhook, updateWebhook } = require('../middleware/schemas/webhooks');

const router = Router();
const ctrl = crudController(Webhook);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('webhooks.view'), ctrl.list);
router.get('/:id', requirePermission('webhooks.view'), ctrl.get);
router.post('/', requirePermission('webhooks.create'), validate(createWebhook), ctrl.create);
router.put('/:id', requirePermission('webhooks.update'), validate(updateWebhook), ctrl.update);
router.delete('/:id', requirePermission('webhooks.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('webhooks.update'), ctrl.restore);

// List recent webhook deliveries
router.get('/:id/deliveries', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const deliveries = await Webhook.getDeliveries(req.params.id);
    res.json({ data: deliveries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
