// =============================================================================
// FireISP 5.0 — Inventory Routes
// =============================================================================

const { Router } = require('express');
const InventoryItem = require('../models/InventoryItem');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInventoryItem, updateInventoryItem, createInventoryTransaction } = require('../middleware/schemas/inventory');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(InventoryItem);

router.use(authenticate);
router.use(orgScope);

// Inventory items
router.get('/items', requirePermission('inventory.view'), ctrl.list);
router.get('/items/:id', requirePermission('inventory.view'), ctrl.get);
router.post('/items', requirePermission('inventory.create'), validate(createInventoryItem), ctrl.create);
router.put('/items/:id', requirePermission('inventory.update'), validate(updateInventoryItem), ctrl.update);
router.delete('/items/:id', requirePermission('inventory.delete'), ctrl.destroy);
router.post('/items/:id/restore', requirePermission('inventory.update'), ctrl.restore);

// Stock levels for an item
router.get('/items/:id/stock', requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const stock = await InventoryItem.getStock(req.params.id);
    res.json({ data: stock });
  } catch (err) {
    next(err);
  }
});

// Record inventory transaction (receive, assign, transfer, etc.)
router.post('/transactions', requirePermission('inventory.create'), validate(createInventoryTransaction), async (req, res, next) => {
  try {
    const { stock_id, transaction_type, quantity, unit_price, job_id, client_id, invoice_id, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, unit_price, job_id, client_id, invoice_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [stock_id, transaction_type, quantity, unit_price || null, job_id || null,
        client_id || null, invoice_id || null, notes || null],
    );

    // Update stock quantity
    const isInbound = ['receive', 'transfer_in', 'return'].includes(transaction_type);
    const quantityChange = isInbound ? Math.abs(quantity) : -Math.abs(quantity);

    await db.query(
      'UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?',
      [quantityChange, stock_id],
    );

    const [rows] = await db.query('SELECT * FROM inventory_transactions WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
