// =============================================================================
// FireISP 5.0 — Warehouse Routes
// =============================================================================

const { Router } = require('express');
const Warehouse = require('../models/Warehouse');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createWarehouse, updateWarehouse } = require('../middleware/schemas/warehouses');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Warehouse);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('inventory.view'), ctrl.list);
router.get('/:id', requirePermission('inventory.view'), ctrl.get);
router.post('/', requirePermission('inventory.create'), validate(createWarehouse), ctrl.create);
router.put('/:id', requirePermission('inventory.update'), validate(updateWarehouse), ctrl.update);
router.delete('/:id', requirePermission('inventory.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('inventory.update'), ctrl.restore);

// Warehouse stock
router.get('/:id/stock', requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, i.name AS item_name, i.sku, i.category
       FROM inventory_stock s
       JOIN inventory_items i ON i.id = s.item_id
       WHERE s.warehouse_id = ? AND s.organization_id = ?`,
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
