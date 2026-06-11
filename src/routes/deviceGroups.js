// =============================================================================
// FireISP 5.0 — Device Group Routes  §6.1
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const DeviceGroup = require('../models/DeviceGroup');
const { createDeviceGroup, updateDeviceGroup, addGroupMembers } = require('../middleware/schemas/deviceGroups');

const router = Router();
router.use(authenticate);
router.use(orgScope);

const ctrl = crudController(DeviceGroup);

router.get('/',     requirePermission('device_groups.view'),   ctrl.list);
router.get('/:id',  requirePermission('device_groups.view'),   ctrl.get);
router.post('/',    requirePermission('device_groups.create'),  validate(createDeviceGroup), ctrl.create);
router.put('/:id',  requirePermission('device_groups.update'),  validate(updateDeviceGroup), ctrl.update);
router.delete('/:id', requirePermission('device_groups.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('device_groups.update'), ctrl.restore);

// Sub-resource: members
router.get('/:id/members', requirePermission('device_groups.view'), async (req, res, next) => {
  try {
    const members = await DeviceGroup.getMembers(req.params.id, req.orgId);
    res.json({ data: members });
  } catch (err) { next(err); }
});

router.post('/:id/members', requirePermission('device_groups.update'), validate(addGroupMembers), async (req, res, next) => {
  try {
    const added = await DeviceGroup.addMembers(req.params.id, req.body.device_ids);
    res.json({ data: { added } });
  } catch (err) { next(err); }
});

router.delete('/:id/members/:deviceId', requirePermission('device_groups.update'), async (req, res, next) => {
  try {
    const removed = await DeviceGroup.removeMember(req.params.id, req.params.deviceId);
    if (!removed) return res.status(404).json({ error: { message: 'Member not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
