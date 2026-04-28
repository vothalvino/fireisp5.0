// =============================================================================
// FireISP 5.0 — Device Routes
// =============================================================================

const { Router } = require('express');
const Device = require('../models/Device');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createDevice, updateDevice, patchDevice } = require('../middleware/schemas/devices');
const { httpCache, bustCache } = require('../middleware/httpCache');
const { quotaCheck } = require('../middleware/checkQuota');
const db = require('../config/database');
const auditLog = require('../services/auditLog');
const { pubsub } = require('../services/pubsub');

const router = Router();
const ctrl = crudController(Device, { cacheResource: 'devices' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), httpCache('devices', 120), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), quotaCheck('devices'), validate(createDevice), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateDevice), async (req, res, next) => {
  try {
    const old = await Device.findByIdOrFail(req.params.id, req.orgId);
    const record = await Device.update(req.params.id, req.body, req.orgId);
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'update',
      tableName: Device.tableName,
      recordId: record.id,
      oldValues: old,
      newValues: req.body,
    });
    await bustCache(req.orgId, 'devices');
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: record, orgId: req.orgId });
    res.json({ data: record });
  } catch (err) { next(err); }
});
router.patch('/:id', requirePermission('devices.update'), validate(patchDevice), ctrl.partialUpdate);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

// Device SNMP metrics
router.get('/:id/snmp-metrics', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const [rows] = await db.query(
      'SELECT * FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT ?',
      [req.params.id, limit],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
