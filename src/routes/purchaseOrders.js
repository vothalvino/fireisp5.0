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
const inventorySerialService = require('../services/inventorySerialService');
const { ValidationError } = require('../utils/errors');

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
//
// Body:
//   received_date?  string   — defaults to today when the PO becomes fully 'received'
//   notes?          string   — copied onto each inventory_transactions row this call writes
//   items?          Array<{ id: number, quantity_received: number }>
//                   Optional partial-receive instructions. `quantity_received` is the
//                   CUMULATIVE total now received for that line (e.g. "3 of 5 have
//                   arrived so far"), not a delta — matches reading a packing slip
//                   against the PO. Lines omitted from `items` are left unchanged.
//                   A value below the line's current quantity_received is clamped up
//                   (no support for reversing a receipt in Phase 1).
//                   Omitting `items` entirely preserves the original full-receive
//                   behavior: every line is received in full.
//   serials?        { [lineItemId: number]: string[] }
//                   Inventory Phase 3 (migration 391): required when a line's
//                   inventory_items.serial_required is ON — the array length
//                   MUST equal that line's incremental delta THIS call (not
//                   the cumulative total), matching quantity_received's own
//                   "packing slip" semantics. Validated in a pass over every
//                   line BEFORE any write; a 422 here leaves the PO/stock/
//                   cpe_devices completely untouched. One cpe_devices row
//                   (in_stock, linked to the line's inventory_item_id) is
//                   minted per serial, in the SAME transaction as the stock
//                   increment below.
//
// Runs inside a single DB transaction — a mid-loop failure leaves neither stock
// nor the PO's status changed — and, for every line that actually gains
// quantity, writes an inventory_transactions row (type 'receive', reference =
// the PO number) so PO-driven stock increases show up in the stock-movement
// ledger exactly like a manual receive does.
router.post('/:id/receive', requirePermission('purchase_orders.receive'), validate(receivePo), async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(parseInt(req.params.id, 10), req.orgId);
    if (!po) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    if (po.status === 'cancelled') return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Cannot receive a cancelled purchase order' } });
    if (po.status === 'received') return res.status(400).json({ error: { code: 'ALREADY_RECEIVED', message: 'Purchase order already fully received' } });

    // Validate optional partial-receive overrides up front (before opening a
    // transaction) so a malformed body 422s cleanly instead of mid-loop.
    let overrides = null;
    if (req.body.items !== undefined) {
      if (!Array.isArray(req.body.items)) {
        return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'items must be an array of { id, quantity_received }' } });
      }
      overrides = new Map();
      for (const entry of req.body.items) {
        const lineId = Number(entry && entry.id);
        const qty = Number(entry && entry.quantity_received);
        if (!Number.isInteger(lineId) || !Number.isFinite(qty) || qty < 0) {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Each items[] entry needs a numeric id and a non-negative quantity_received' } });
        }
        overrides.set(lineId, qty);
      }
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [lineItems] = await conn.query(
        'SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id',
        [po.id],
      );

      // Resolve serial_required per referenced inventory item (a small extra
      // query per distinct item, not joined into the line-items SELECT above
      // so the pre-391 query shape/behavior for non-serialized POs is
      // byte-for-byte unchanged). Missing/unknown resolves to "not required"
      // — real FK-backed rows always resolve to a real 0/1.
      const serialRequiredByItemId = new Map();
      for (const item of lineItems) {
        if (!item.inventory_item_id || serialRequiredByItemId.has(item.inventory_item_id)) continue;
        const [rows] = await conn.query(
          'SELECT serial_required FROM inventory_items WHERE id = ?',
          [item.inventory_item_id],
        );
        serialRequiredByItemId.set(item.inventory_item_id, !!(rows[0] && rows[0].serial_required));
      }

      // ---- Pass 1: compute every line's delta + validate serial counts BEFORE any write ----
      const planned = new Map(); // po_item.id -> { target, delta }
      const bodySerials = req.body.serials && typeof req.body.serials === 'object' ? req.body.serials : {};
      for (const item of lineItems) {
        const currentReceived = item.quantity_received;
        const target = overrides
          ? Math.min(Math.max(overrides.get(item.id) ?? currentReceived, currentReceived), item.quantity_ordered)
          : item.quantity_ordered;
        const delta = target - currentReceived;
        planned.set(item.id, { target, delta });

        const isSerialRequired = delta > 0 && item.inventory_item_id && serialRequiredByItemId.get(item.inventory_item_id);
        if (isSerialRequired) {
          // Both the serial-count check AND the mint/stock write below are
          // otherwise gated on po.warehouse_id — a serialized item received
          // on a warehouse-less PO would silently succeed with no serials,
          // no cpe_devices rows, and no stock write at all. Reject up front,
          // before any write, instead of quietly skipping serialization.
          // Non-serialized items on warehouse-less POs are unaffected.
          if (!po.warehouse_id) {
            throw new ValidationError(
              `Line ${item.id} is a serial-tracked item — this purchase order has no warehouse set, so serialized items cannot be received. Set a warehouse on the purchase order first.`,
            );
          }
          const provided = bodySerials[item.id] ?? bodySerials[String(item.id)];
          if (!Array.isArray(provided) || provided.length !== delta) {
            throw new ValidationError(
              `Line ${item.id} is a serial-tracked item — provide exactly ${delta} serial number(s) in serials[${item.id}] (got ${Array.isArray(provided) ? provided.length : 0})`,
            );
          }
        }
      }

      let anyReceived = false;
      let allFullyReceived = lineItems.length > 0;

      // ---- Pass 2: apply ----
      for (const item of lineItems) {
        const { target, delta } = planned.get(item.id);

        if (delta > 0) {
          if (item.inventory_item_id && po.warehouse_id) {
            const [existing] = await conn.query(
              'SELECT id FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND aisle IS NULL AND col IS NULL AND shelf IS NULL AND deleted_at IS NULL',
              [item.inventory_item_id, po.warehouse_id],
            );
            let stockId;
            if (existing.length > 0) {
              stockId = existing[0].id;
              await conn.query('UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?', [delta, stockId]);
            } else {
              const [ins] = await conn.query(
                'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, ?)',
                [item.inventory_item_id, po.warehouse_id, delta],
              );
              stockId = ins.insertId;
            }
            await conn.query(
              `INSERT INTO inventory_transactions
                 (stock_id, transaction_type, quantity, unit_price, reference, notes, performed_by)
               VALUES (?, 'receive', ?, ?, ?, ?, ?)`,
              [stockId, delta, item.unit_cost, po.po_number, req.body.notes || null, req.user?.id || null],
            );

            if (serialRequiredByItemId.get(item.inventory_item_id)) {
              const provided = bodySerials[item.id] ?? bodySerials[String(item.id)];
              await inventorySerialService.createTrackedUnits(conn.query.bind(conn), {
                orgId: req.orgId,
                itemId: item.inventory_item_id,
                serials: provided,
              });
            }
          }
          await conn.query('UPDATE purchase_order_items SET quantity_received = ? WHERE id = ?', [target, item.id]);
        }

        if (target > 0) anyReceived = true;
        if (target < item.quantity_ordered) allFullyReceived = false;
      }

      const newStatus = lineItems.length === 0
        ? po.status
        : allFullyReceived ? 'received' : anyReceived ? 'partial' : po.status;
      const receivedDate = newStatus === 'received'
        ? (req.body.received_date || new Date().toISOString().slice(0, 10))
        : po.received_date;

      await conn.query(
        'UPDATE purchase_orders SET status = ?, received_date = ? WHERE id = ?',
        [newStatus, receivedDate, po.id],
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const updatedPo = await PurchaseOrder.findById(po.id, req.orgId);
    res.json({ data: updatedPo });
  } catch (err) { next(err); }
});

module.exports = router;
