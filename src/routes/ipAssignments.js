// =============================================================================
// FireISP 5.0 — IP Assignment Routes
// =============================================================================

const { Router } = require('express');
const IpAssignment = require('../models/IpAssignment');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createIpAssignment, updateIpAssignment } = require('../middleware/schemas/ipAssignments');
const provisioningService = require('../services/subscriberProvisioningService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(IpAssignment);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('ip_assignments.view'), ctrl.list);
router.get('/:id', requirePermission('ip_assignments.view'), ctrl.get);
router.post('/', requirePermission('ip_assignments.create'), validate(createIpAssignment), async (req, res, next) => {
  try {
    await provisioningService.assertIpAvailable(db, {
      ip: req.body.ip_address,
      organizationId: req.orgId,
      excludeContractId: req.body.contract_id || null,
    });
    return ctrl.create(req, res, next);
  } catch (err) { return next(err); }
});
router.put('/:id', requirePermission('ip_assignments.update'), validate(updateIpAssignment), async (req, res, next) => {
  try {
    if (req.body.ip_address) {
      const existing = await IpAssignment.findByIdOrFail(req.params.id, req.orgId);
      if (req.body.ip_address !== existing.ip_address) {
        await provisioningService.assertIpAvailable(db, {
          ip: req.body.ip_address,
          organizationId: req.orgId,
          excludeContractId: req.body.contract_id || existing.contract_id || null,
        });
      }
    }
    return ctrl.update(req, res, next);
  } catch (err) { return next(err); }
});
router.delete('/:id', requirePermission('ip_assignments.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('ip_assignments.update'), ctrl.restore);

module.exports = router;
