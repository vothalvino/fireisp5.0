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
const { createDevice, updateDevice } = require('../middleware/schemas/devices');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Device);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createDevice), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateDevice), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);

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
