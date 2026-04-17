// =============================================================================
// FireISP 5.0 — RADIUS Routes
// =============================================================================

const { Router } = require('express');
const Radius = require('../models/Radius');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRadius, updateRadius } = require('../middleware/schemas/radius');

const router = Router();
const ctrl = crudController(Radius);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createRadius), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateRadius), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

// Get RADIUS accounts for a specific contract
router.get('/contract/:contractId', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const accounts = await Radius.findByContract(req.params.contractId);
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
