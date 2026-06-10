// =============================================================================
// FireISP 5.0 — Client Interaction Routes (§1.3)
// =============================================================================

const { Router } = require('express');
const ClientInteraction = require('../models/ClientInteraction');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInteraction, updateInteraction, patchInteraction } = require('../middleware/schemas/interactions');

const router = Router();
const ctrl = crudController(ClientInteraction, { cacheResource: 'interactions' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('interactions.view'), ctrl.list);
router.get('/:id', requirePermission('interactions.view'), ctrl.get);
router.post('/', requirePermission('interactions.create'), validate(createInteraction), (req, res, next) => {
  // Default the author to the logged-in staff member.
  if (req.body.user_id === undefined && req.user?.id) req.body.user_id = req.user.id;
  return ctrl.create(req, res, next);
});
router.put('/:id', requirePermission('interactions.update'), validate(updateInteraction), ctrl.update);
router.patch('/:id', requirePermission('interactions.update'), validate(patchInteraction), ctrl.partialUpdate);
router.delete('/:id', requirePermission('interactions.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('interactions.update'), ctrl.restore);

module.exports = router;
