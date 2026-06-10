// =============================================================================
// FireISP 5.0 — Client Group Routes (family/account grouping) — §1.1
// =============================================================================

const { Router } = require('express');
const ClientGroup = require('../models/ClientGroup');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createClientGroup, updateClientGroup } = require('../middleware/schemas/clientGroups');

const router = Router();
const ctrl = crudController(ClientGroup, { cacheResource: 'client-groups' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('clients.view'), ctrl.list);
router.get('/:id', requirePermission('clients.view'), ctrl.get);
router.post('/', requirePermission('clients.create'), validate(createClientGroup), ctrl.create);
router.put('/:id', requirePermission('clients.update'), validate(updateClientGroup), ctrl.update);
router.patch('/:id', requirePermission('clients.update'), validate(updateClientGroup), ctrl.partialUpdate);
router.delete('/:id', requirePermission('clients.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('clients.update'), ctrl.restore);

// Members of a group
router.get('/:id/members', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await ClientGroup.findByIdOrFail(req.params.id, req.orgId);
    const members = await ClientGroup.getMembers(req.params.id, req.orgId);
    res.json({ data: members });
  } catch (err) { next(err); }
});

module.exports = router;
