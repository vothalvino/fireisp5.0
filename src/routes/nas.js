// =============================================================================
// FireISP 5.0 — NAS Routes
// =============================================================================

const { Router } = require('express');
const Nas = require('../models/Nas');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createNas, updateNas } = require('../middleware/schemas/nas');
const { httpCache } = require('../middleware/httpCache');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Nas, { cacheResource: 'nas' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), httpCache('nas', 300), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createNas), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateNas), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

// =============================================================================
// NAS Health (item: health check results and manual trigger)
// =============================================================================

router.get('/:id/health', requirePermission('nas.health'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, ip_address, health_status, last_health_check_at FROM nas WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'NAS not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/health-check', requirePermission('nas.health'), async (req, res, next) => {
  try {
    const { runHealthChecks } = require('../services/nasHealthService');
    const result = await runHealthChecks(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
