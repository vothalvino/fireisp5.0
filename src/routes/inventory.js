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
const { NotFoundError, ValidationError } = require('../utils/errors');
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
//
// stock_id is normally required, but for transaction_type 'receive' or
// 'adjustment' the caller may instead pass item_id + warehouse_id: if no
// inventory_stock row exists yet for that item/warehouse pair, one is created
// (starting at 0) before the transaction is applied. This is what lets a
// brand-new inventory item receive its FIRST stock through this endpoint
// instead of only ever being creatable via a Purchase Order receive.
// Other transaction types (assign_to_job, sell_to_client, transfer_out, ...)
// still require an existing stock_id — there is nothing sensible to "create"
// when moving stock OUT of a location that never had any.
router.post('/transactions', requirePermission('inventory.create'), validate(createInventoryTransaction), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    let { stock_id } = req.body;
    const { transaction_type, quantity, unit_price, job_id, client_id, invoice_id, reference, notes, item_id, warehouse_id } = req.body;

    await conn.beginTransaction();

    if (!stock_id) {
      if (!item_id || !warehouse_id) {
        throw new ValidationError(
          'stock_id is required, or provide item_id and warehouse_id to receive stock into a new location',
          [{ field: 'stock_id', message: 'stock_id is required unless item_id and warehouse_id are both provided' }],
        );
      }
      if (!['receive', 'adjustment'].includes(transaction_type)) {
        throw new ValidationError(
          `stock_id is required for transaction_type "${transaction_type}" — that item has no stock at this location yet`,
          [{ field: 'stock_id', message: 'stock_id is required for this transaction type' }],
        );
      }

      const [[item]] = await conn.query(
        'SELECT id FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
        [item_id, req.orgId],
      );
      if (!item) throw new NotFoundError('Inventory item');

      const [[warehouse]] = await conn.query(
        'SELECT id FROM warehouses WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
        [warehouse_id, req.orgId],
      );
      if (!warehouse) throw new NotFoundError('Warehouse');

      const [existing] = await conn.query(
        'SELECT id FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND aisle IS NULL AND col IS NULL AND shelf IS NULL AND deleted_at IS NULL',
        [item_id, warehouse_id],
      );
      if (existing.length > 0) {
        stock_id = existing[0].id;
      } else {
        const [ins] = await conn.query(
          'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, 0)',
          [item_id, warehouse_id],
        );
        stock_id = ins.insertId;
      }
    } else {
      // FK-safe existence check, org-scoped through the item — without this, a
      // non-existent or cross-org stock_id would only surface as a raw MySQL
      // FK-violation 500 from the INSERT below.
      const [[stockRow]] = await conn.query(
        `SELECT s.id FROM inventory_stock s
         JOIN inventory_items i ON i.id = s.item_id
         WHERE s.id = ? AND s.deleted_at IS NULL AND (i.organization_id = ? OR i.organization_id IS NULL)`,
        [stock_id, req.orgId],
      );
      if (!stockRow) throw new NotFoundError('Stock location');
    }

    const [result] = await conn.query(
      `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, unit_price, job_id, client_id, invoice_id, performed_by, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [stock_id, transaction_type, quantity, unit_price || null, job_id || null,
        client_id || null, invoice_id || null, req.user?.id || null, reference || null, notes || null],
    );

    // Update stock quantity
    const isInbound = ['receive', 'transfer_in', 'return'].includes(transaction_type);
    const quantityChange = isInbound ? Math.abs(quantity) : -Math.abs(quantity);

    await conn.query(
      'UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?',
      [quantityChange, stock_id],
    );

    await conn.commit();

    const [rows] = await db.query('SELECT * FROM inventory_transactions WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
