// =============================================================================
// FireISP 5.0 — Message Template Routes
// =============================================================================

const { Router } = require('express');
const MessageTemplate = require('../models/MessageTemplate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');

const router = Router();
const ctrl = crudController(MessageTemplate);

const createMessageTemplate = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  channel: { type: 'string', required: true, enum: ['email', 'sms', 'whatsapp', 'push'] },
  subject: { type: 'string', max: 500 },
  body: { type: 'string', required: true },
  variables: { type: 'string', max: 2000 },
};

const updateMessageTemplate = {
  name: { type: 'string', min: 1, max: 200 },
  channel: { type: 'string', enum: ['email', 'sms', 'whatsapp', 'push'] },
  subject: { type: 'string', max: 500 },
  body: { type: 'string' },
  variables: { type: 'string', max: 2000 },
};

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('settings.view'), ctrl.list);
router.get('/:id', requirePermission('settings.view'), ctrl.get);
router.post('/', requirePermission('settings.update'), validate(createMessageTemplate), ctrl.create);
router.put('/:id', requirePermission('settings.update'), validate(updateMessageTemplate), ctrl.update);
router.delete('/:id', requirePermission('settings.update'), ctrl.destroy);
router.post('/:id/restore', requirePermission('settings.update'), ctrl.restore);

module.exports = router;
