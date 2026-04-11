// =============================================================================
// FireISP 5.0 — Plan Routes
// =============================================================================

const { Router } = require('express');
const Plan = require('../models/Plan');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Plan);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('plans.view'), ctrl.list);
router.get('/:id', requirePermission('plans.view'), ctrl.get);
router.post('/', requirePermission('plans.create'), ctrl.create);
router.put('/:id', requirePermission('plans.update'), ctrl.update);
router.delete('/:id', requirePermission('plans.delete'), ctrl.destroy);

// Plan add-ons
router.get('/addons/catalog', requirePermission('plans.view'), async (req, res, next) => {
  try {
    const addons = await Plan.getAddons(req.orgId);
    res.json({ data: addons });
  } catch (err) {
    next(err);
  }
});

router.post('/addons', requirePermission('plans.create'), async (req, res, next) => {
  try {
    const { name, addon_type, price, billing_cycle, taxable, status } = req.body;
    const [result] = await db.query(
      `INSERT INTO plan_addons (organization_id, name, addon_type, price, billing_cycle, taxable, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, addon_type, price, billing_cycle, taxable !== false, status || 'active'],
    );
    const [rows] = await db.query('SELECT * FROM plan_addons WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
