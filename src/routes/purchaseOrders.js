// =============================================================================
// FireISP 5.0 — Purchase Order Routes — §14.2
// =============================================================================

const { Router } = require('express');
const PurchaseOrder = require('../models/PurchaseOrder');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createPurchaseOrder, updatePurchaseOrder,
  createPoItem, updatePoItem, receivePo,
} = require('../middleware/schemas/purchaseOrders');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(PurchaseOrder);

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Purchase Orders CRUD
// ---------------------------------------------------------------------------

router.get('/', requirePermission('purchase_orders.view'), ctrl.list);
router.get('/:id', requirePermission('purchase_orders.view'), ctrl.get);
router.post('/', requirePermission('purchase_orders.create'), validate(createPurchaseOrder), ctrl.create);
router.put('/:id', requirePermission('purchase_orders.update'), validate(updatePurchaseOrder), ctrl.update);
router.delete('/:id', requirePermission('purchase_orders.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('purchase_orders.update'), ctrl.restore);

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

// GET /purchase-orders/:id/items
router.get('/:id/items', requirePermission('purchase_orders.view'), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    const items = await PurchaseOrder.getItems(po.id);
    res.json({ data: items });
  } catch (err) { next(err); }
});

// POST /purchase-orders/:id/items
router.post('/:id/items', requirePermission('purchase_orders.update'), validate(createPoItem), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    const { inventory_item_id, description, quantity_ordered, quantity_received, unit_cost, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO purchase_order_items (po_id, inventory_item_id, description, quantity_ordered, quantity_received, unit_cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [po.id, inventory_item_id || null, description, quantity_ordered, quantity_received || 0, unit_cost || 0, notes || null],
    );
    const [rows] = await db.query('SELECT * FROM purchase_order_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /purchase-orders/:id/items/:itemId
router.put('/:id/items/:itemId', requirePermission('purchase_orders.update'), validate(updatePoItem), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    const { inventory_item_id, description, quantity_ordered, quantity_received, unit_cost, notes } = req.body;
    const fields = [];
    const vals = [];
    if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
    if (quantity_ordered !== undefined) { fields.push('quantity_ordered = ?'); vals.push(quantity_ordered); }
    if (quantity_received !== undefined) { fields.push('quantity_received = ?'); vals.push(quantity_received); }
    if (unit_cost !== undefined) { fields.push('unit_cost = ?'); vals.push(unit_cost); }
    if (inventory_item_id !== undefined) { fields.push('inventory_item_id = ?'); vals.push(inventory_item_id); }
    if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
    if (fields.length === 0) return res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No fields to update' } });
    vals.push(parseInt(req.params.itemId, 10), po.id);
    const [upd] = await db.query(`UPDATE purchase_order_items SET ${fields.join(', ')} WHERE id = ? AND po_id = ?`, vals);
    if (upd.affectedRows === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Line item not found' } });
    const [rows] = await db.query('SELECT * FROM purchase_order_items WHERE id = ?', [parseInt(req.params.itemId, 10)]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /purchase-orders/:id/items/:itemId
router.delete('/:id/items/:itemId', requirePermission('purchase_orders.update'), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    const [del] = await db.query('DELETE FROM purchase_order_items WHERE id = ? AND po_id = ?',
      [parseInt(req.params.itemId, 10), po.id]);
    if (del.affectedRows === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Line item not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Receive a PO — marks it received and updates inventory stock
// ---------------------------------------------------------------------------

// POST /purchase-orders/:id/receive
router.post('/:id/receive', requirePermission('purchase_orders.receive'), validate(receivePo), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    if (po.status === 'cancelled') return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Cannot receive a cancelled purchase order' } });
    if (po.status === 'received') return res.status(400).json({ error: { code: 'ALREADY_RECEIVED', message: 'Purchase order already fully received' } });

    // Get line items
    const items = await PurchaseOrder.getItems(po.id);

    // Update each line item quantity_received = quantity_ordered
    for (const item of items) {
      if (!item.inventory_item_id) continue;
      const qty = item.quantity_ordered;

      // Upsert inventory_stock for this item in the PO's warehouse
      const warehouseId = po.warehouse_id;
      if (warehouseId) {
        const [existing] = await db.query(
          'SELECT id, quantity FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND deleted_at IS NULL',
          [item.inventory_item_id, warehouseId],
        );
        if (existing.length > 0) {
          await db.query('UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?', [qty, existing[0].id]);
        } else {
          await db.query(
            'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, ?)',
            [item.inventory_item_id, warehouseId, qty],
          );
        }
      }
      await db.query('UPDATE purchase_order_items SET quantity_received = quantity_ordered WHERE id = ?', [item.id]);
    }

    // Update PO status and received_date
    const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
    await db.query(
      'UPDATE purchase_orders SET status = ?, received_date = ? WHERE id = ?',
      ['received', receivedDate, po.id],
    );
    const updatedPo = await PurchaseOrder.findById(po.id, req.orgId);
    res.json({ data: updatedPo });
  } catch (err) { next(err); }
});

module.exports = router;
