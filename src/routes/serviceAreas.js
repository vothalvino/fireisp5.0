// =============================================================================
// FireISP 5.0 — Service Area Routes
// =============================================================================

const { Router } = require('express');
const ServiceArea = require('../models/ServiceArea');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createServiceArea, updateServiceArea } = require('../middleware/schemas/serviceAreas');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(ServiceArea);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('service_areas.view'), ctrl.list);
router.get('/:id', requirePermission('service_areas.view'), ctrl.get);
router.post('/', requirePermission('service_areas.create'), validate(createServiceArea), ctrl.create);
router.put('/:id', requirePermission('service_areas.update'), validate(updateServiceArea), ctrl.update);
router.delete('/:id', requirePermission('service_areas.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('service_areas.update'), ctrl.restore);

// List coverage zones for a service area
router.get('/:id/coverage-zones', requirePermission('service_areas.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM coverage_zones WHERE service_area_id = ? AND deleted_at IS NULL ORDER BY id',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
