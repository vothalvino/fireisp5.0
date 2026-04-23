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
const webhookService = require('../services/webhookService');

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

// List dead-letter deliveries for this organization
router.get('/dead-letters', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = await webhookService.listDeadLetters(req.orgId, limit);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

// Re-deliver a dead-letter delivery by its ID
router.post('/deliveries/:deliveryId/redeliver', requirePermission('webhooks.update'), async (req, res, next) => {
  try {
    const result = await webhookService.redeliverDeadLetter(Number(req.params.deliveryId));
    if (result.status === 'not_found') {
      return res.status(404).json({ message: 'Dead-letter delivery not found' });
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// List recent webhook deliveries for a specific webhook
router.get('/:id/deliveries', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const deliveries = await Webhook.getDeliveries(req.params.id);
    res.json({ data: deliveries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
