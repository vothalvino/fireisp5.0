// =============================================================================
// FireISP 5.0 — Inventory Phase 3: Serialized Equipment Service (§14.2 cont'd)
// =============================================================================
// Serialized equipment tracking end to end (migration 391, user-confirmed
// design — see that migration's header comment for the full rationale):
//
//   • createTrackedUnits — PO receive of a serial_required item mints one
//     cpe_devices row per serial, in_stock, inside the SAME transaction the
//     PO route already opened (src/routes/purchaseOrders.js).
//   • registerSerial     — manual add from the CPE Inventory page (legacy
//     devices / catch-up for stock that predates the serial_required
//     toggle). Catch-up (default) never touches inventory_stock.quantity;
//     increment_stock=true additionally receives +1 with a ledger row.
//   • installEquipment   — the drawdown moment. Picks an existing in-stock
//     serial OR registers a brand-new one on the fly ("type-a-new-serial"),
//     transitions it to 'assigned', and decrements stock exactly once:
//       - ownership='rented' -> inventory_transactions 'assign_to_job', no invoice.
//       - ownership='sold'   -> billingService.createOneOffInvoice(inventoryItemId)
//         raises a real invoice AND draws down stock in that same call —
//         this function must NOT also decrement for the sold case.
//   • ensurePickupWorkOrder / completePickupUnit — the technician follow-up
//     when a contract with outstanding RENTED equipment is cancelled: an
//     idempotent 'pickup' work order is auto-created, and completing it
//     per-unit either returns the serial to stock (+1, ledger 'return') or
//     marks it 'rma' (no stock change — it never crosses back into stock).
//
// Consistency invariant (enforced throughout this file, per PR brief):
//   For serial_required items, inventory_stock.quantity counts ALL physical
//   units including untracked legacy stock; tracked units (cpe_devices with
//   a matching inventory_item_id, lifecycle_state='in_stock') must NEVER
//   exceed it. Every state change that crosses the stock boundary (in_stock
//   <-> out) moves quantity AND writes a ledger row in the SAME transaction,
//   org-scoped throughout.
// =============================================================================

'use strict';

const db = require('../config/database');
const cpeInventoryService = require('./cpeInventoryService');
const billingService = require('./billingService');
const { resolveOrCreateStockRow } = require('./inventoryDrawdownService');
const { ValidationError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'inventorySerialService' });

// ---------------------------------------------------------------------------
// Shared lookups (org-scoped throughout — cross-org access always 422/404s)
// ---------------------------------------------------------------------------

async function _loadItem(execute, itemId, orgId) {
  const [rows] = await execute(
    'SELECT * FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [itemId, orgId],
  );
  if (!rows[0]) throw new ValidationError('inventory_item_id does not belong to this organization');
  return rows[0];
}

async function _assertSerialNotTaken(execute, serialNumber, orgId) {
  const [rows] = await execute(
    'SELECT id FROM cpe_devices WHERE serial_number = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL LIMIT 1',
    [serialNumber, orgId],
  );
  if (rows[0]) {
    throw new ValidationError(`Serial number '${serialNumber}' is already registered in this organization`);
  }
}

/**
 * Untracked capacity for a serial_required item: inventory_stock.quantity
 * (summed org-wide) minus the count of already-tracked in_stock units. Must
 * stay > 0 before a type-new-serial registration is allowed to consume one
 * unit of it (PR brief item 4's guard).
 */
async function _untrackedCapacity(execute, itemId, orgId) {
  const [[stockRow]] = await execute(
    `SELECT COALESCE(SUM(s.quantity), 0) AS total
     FROM inventory_stock s
     JOIN inventory_items i ON i.id = s.item_id
     WHERE s.item_id = ? AND s.deleted_at IS NULL AND (i.organization_id = ? OR i.organization_id IS NULL)`,
    [itemId, orgId],
  );
  const [[trackedRow]] = await execute(
    `SELECT COUNT(*) AS total FROM cpe_devices
     WHERE inventory_item_id = ? AND lifecycle_state = 'in_stock' AND deleted_at IS NULL
       AND (organization_id = ? OR organization_id IS NULL)`,
    [itemId, orgId],
  );
  return Number(stockRow.total) - Number(trackedRow.total);
}

// ---------------------------------------------------------------------------
// PO receive — mint N tracked units for a serial_required line
// ---------------------------------------------------------------------------

/**
 * Create `serials.length` cpe_devices rows (in_stock, linked to itemId) on
 * the caller's transaction connection. Caller (purchaseOrders.js) is
 * responsible for enforcing serials.length === quantity received BEFORE
 * calling this (422 before any write) and for the inventory_stock/ledger
 * 'receive' side effect — this only mints the per-serial rows themselves.
 * @param {(sql: string, params: unknown[]) => Promise<[unknown, unknown]>} execute
 */
async function createTrackedUnits(execute, { orgId, itemId, serials }) {
  const created = [];
  for (const serialNumber of serials) {
    const trimmed = String(serialNumber).trim();
    if (!trimmed) throw new ValidationError('Serial numbers cannot be blank');
    await _assertSerialNotTaken(execute, trimmed, orgId);
    const [ins] = await execute(
      `INSERT INTO cpe_devices (organization_id, serial_number, oui, inventory_item_id, lifecycle_state)
       VALUES (?, ?, NULL, ?, 'in_stock')`,
      [orgId, trimmed, itemId],
    );
    created.push(ins.insertId);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Manual registration (CPE Inventory page)
// ---------------------------------------------------------------------------

async function registerSerial({
  orgId, itemId, serialNumber, warehouseId = null, manufacturer = null,
  modelName = null, notes = null, incrementStock = false, performedBy = null,
}) {
  const trimmed = String(serialNumber).trim();
  if (!trimmed) throw new ValidationError('serial_number cannot be blank');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const execute = conn.execute.bind(conn);

    await _loadItem(execute, itemId, orgId);
    await _assertSerialNotTaken(execute, trimmed, orgId);

    const [ins] = await execute(
      `INSERT INTO cpe_devices
         (organization_id, serial_number, oui, manufacturer, model_name, inventory_item_id, lifecycle_state, notes)
       VALUES (?, ?, NULL, ?, ?, ?, 'in_stock', ?)`,
      [orgId, trimmed, manufacturer, modelName, itemId, notes],
    );
    const deviceId = ins.insertId;

    // Catch-up (default) never touches inventory_stock.quantity — the brief
    // is explicit that registering a serial for stock that predates the
    // serial_required toggle must not double-count it. Only an explicit
    // increment_stock=true (a genuinely NEW unit) also receives +1 — against
    // the caller-specified warehouse when given (mirrors PO receive's
    // item_id+warehouse_id upsert exactly), else the same org-wide
    // best-guess row drawdownForSale/install use when no warehouse is known.
    if (incrementStock) {
      let stockId;
      if (warehouseId) {
        const [existing] = await execute(
          'SELECT id FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND aisle IS NULL AND col IS NULL AND shelf IS NULL AND deleted_at IS NULL',
          [itemId, warehouseId],
        );
        if (existing.length > 0) {
          stockId = existing[0].id;
        } else {
          const [insStock] = await execute(
            'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, 0)',
            [itemId, warehouseId],
          );
          stockId = insStock.insertId;
        }
      } else {
        stockId = await resolveOrCreateStockRow(execute, { orgId, itemId });
      }
      await execute('UPDATE inventory_stock SET quantity = quantity + 1 WHERE id = ?', [stockId]);
      await execute(
        `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, performed_by, reference, notes)
         VALUES (?, 'receive', 1, ?, ?, ?)`,
        [stockId, performedBy, `Manual serial registration: ${trimmed}`, notes],
      );
    }

    await conn.commit();
    const [rows] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [deviceId]);
    return rows[0];
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Install — the drawdown moment
// ---------------------------------------------------------------------------

async function installEquipment({
  orgId, contractId, serviceOrderId = null, cpeDeviceId = null,
  newSerial = null, inventoryItemId = null, ownership, performedBy = null,
}) {
  if (!cpeDeviceId && !newSerial) {
    throw new ValidationError('Either cpe_device_id (existing in-stock serial) or new_serial is required');
  }
  if (cpeDeviceId && newSerial) {
    throw new ValidationError('Provide only one of cpe_device_id or new_serial, not both');
  }
  if (newSerial && !inventoryItemId) {
    throw new ValidationError('inventory_item_id is required when registering a new serial at install');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const execute = conn.execute.bind(conn);

    const [contractRows] = await execute(
      'SELECT id, client_id, organization_id FROM contracts WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [contractId, orgId],
    );
    const contract = contractRows[0];
    if (!contract) throw new ValidationError('contract_id does not belong to this organization');

    if (serviceOrderId) {
      const [soRows] = await execute(
        'SELECT id FROM service_orders WHERE id = ? AND contract_id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
        [serviceOrderId, contractId, orgId],
      );
      if (!soRows[0]) throw new ValidationError('service_order_id does not match this contract in this organization');
    }

    let unit;
    if (cpeDeviceId) {
      const [rows] = await execute(
        'SELECT * FROM cpe_devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL FOR UPDATE',
        [cpeDeviceId, orgId],
      );
      unit = rows[0];
      if (!unit) throw new ValidationError('cpe_device_id does not belong to this organization');
      if (unit.lifecycle_state !== 'in_stock') {
        throw new ValidationError(`Unit is not in stock (currently: ${unit.lifecycle_state})`);
      }
      if (!unit.inventory_item_id) {
        throw new ValidationError('This unit is not linked to an inventory item — register it via the CPE Inventory page before installing it');
      }
    } else {
      // Type-a-new-serial: only allowed when the item actually has untracked
      // quantity (inventory_stock.quantity > count of live tracked in_stock
      // units) — PR brief item 4's guard.
      await _loadItem(execute, inventoryItemId, orgId);
      const capacity = await _untrackedCapacity(execute, inventoryItemId, orgId);
      if (capacity <= 0) {
        throw new ValidationError(
          'No untracked stock available for this item — every unit already has a serial on record. Register more stock or pick an existing serial.',
        );
      }
      const trimmed = String(newSerial).trim();
      if (!trimmed) throw new ValidationError('new_serial cannot be blank');
      await _assertSerialNotTaken(execute, trimmed, orgId);
      const [ins] = await execute(
        `INSERT INTO cpe_devices (organization_id, serial_number, oui, inventory_item_id, lifecycle_state)
         VALUES (?, ?, NULL, ?, 'in_stock')`,
        [orgId, trimmed, inventoryItemId],
      );
      const [rows] = await execute('SELECT * FROM cpe_devices WHERE id = ? FOR UPDATE', [ins.insertId]);
      unit = rows[0];
    }

    // Assign: link contract/subscriber + ownership, then transition the
    // lifecycle state on the SAME connection so both writes are atomic.
    await execute(
      'UPDATE cpe_devices SET contract_id = ?, subscriber_id = ?, subscriber_linked_at = NOW(), ownership = ? WHERE id = ?',
      [contractId, contract.client_id, ownership, unit.id],
    );
    await cpeInventoryService.transitionLifecycleState(unit.id, 'assigned', {
      orgId, performedBy, reason: `Installed (${ownership}) on contract #${contractId}`, connection: conn,
    });

    let invoice = null;
    if (ownership === 'rented') {
      // No invoice — stock leaves via 'assign_to_job', mirroring Phase 1/2's
      // ledger column list exactly.
      const stockId = await resolveOrCreateStockRow(execute, { orgId, itemId: unit.inventory_item_id });
      await execute('UPDATE inventory_stock SET quantity = quantity - 1 WHERE id = ?', [stockId]);
      await execute(
        `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, client_id, performed_by, reference, notes)
         VALUES (?, 'assign_to_job', 1, ?, ?, ?, ?)`,
        [stockId, contract.client_id, performedBy, `Install on contract #${contractId}`, `Serial ${unit.serial_number} (rented)`],
      );
    } else {
      // Sold: a real invoice line, product-linked so drawdownForSale (called
      // INSIDE createOneOffInvoice) is the ONE place stock is decremented for
      // this branch — installEquipment must never also decrement here.
      const item = await _loadItem(execute, unit.inventory_item_id, orgId);
      const amount = item.sale_price ?? item.unit_cost;
      if (amount === null || amount === undefined) {
        throw new ValidationError(
          `Item '${item.name}' has no sale_price or unit_cost configured — set one before selling this equipment`,
        );
      }
      invoice = await billingService.createOneOffInvoice({
        orgId,
        clientId: contract.client_id,
        contractId,
        description: `Equipment sale: ${item.name} (SN ${unit.serial_number})`,
        amount,
        conn,
        inventoryItemId: unit.inventory_item_id,
        performedBy,
      });
    }

    await conn.commit();
    const [rows] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [unit.id]);
    return { unit: rows[0], invoice };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Pickup — auto-created on contract cancellation, completed per-unit
// ---------------------------------------------------------------------------

/**
 * Auto-create a 'pickup' work order for a contract that has outstanding
 * RENTED equipment (ownership='rented', lifecycle_state IN assigned/active).
 * Idempotent: a second call while an open pickup order already exists for
 * this contract is a no-op. Sold devices are the client's property and are
 * never counted here. Best-effort by design — callers (contract
 * cancel/terminate) must not let a failure here block the cancellation
 * itself; they log and continue (mirrors suspensionService's audit-write
 * convention in src/routes/contracts.js).
 */
async function ensurePickupWorkOrder(contractId, { orgId = null, performedBy = null } = {}) {
  const [rentedUnits] = await db.query(
    `SELECT id FROM cpe_devices
     WHERE contract_id = ? AND ownership = 'rented' AND lifecycle_state IN ('assigned', 'active') AND deleted_at IS NULL
     LIMIT 1`,
    [contractId],
  );
  if (!rentedUnits.length) return null;

  const [existing] = await db.query(
    `SELECT * FROM work_orders
     WHERE contract_id = ? AND work_type = 'pickup' AND status NOT IN ('completed', 'cancelled') AND deleted_at IS NULL
     LIMIT 1`,
    [contractId],
  );
  if (existing.length) return existing[0];

  const [contractRows] = await db.query('SELECT client_id FROM contracts WHERE id = ? LIMIT 1', [contractId]);
  const clientId = contractRows[0]?.client_id || null;

  const [ins] = await db.query(
    `INSERT INTO work_orders
       (organization_id, client_id, contract_id, title, description, status, priority, work_type, created_by)
     VALUES (?, ?, ?, ?, ?, 'pending', 'medium', 'pickup', ?)`,
    [
      orgId, clientId, contractId,
      'Equipment pickup',
      'Auto-created on contract cancellation: pick up rented equipment, or confirm the client already dropped it off.',
      performedBy,
    ],
  );
  const [rows] = await db.query('SELECT * FROM work_orders WHERE id = ?', [ins.insertId]);
  logger.info({ contractId, workOrderId: ins.insertId }, 'Auto-created equipment pickup work order');
  return rows[0];
}

/**
 * List the outstanding rented-equipment checklist for a pickup work order.
 */
async function getPickupChecklist(workOrderId, orgId) {
  const [woRows] = await db.query(
    "SELECT * FROM work_orders WHERE id = ? AND organization_id = ? AND work_type = 'pickup' AND deleted_at IS NULL",
    [workOrderId, orgId],
  );
  const wo = woRows[0];
  if (!wo) throw new NotFoundError('Pickup work order');
  if (!wo.contract_id) return { workOrder: wo, units: [] };

  const [units] = await db.query(
    `SELECT d.*, i.name AS item_name, i.sku
     FROM cpe_devices d
     LEFT JOIN inventory_items i ON i.id = d.inventory_item_id
     WHERE d.contract_id = ? AND d.ownership = 'rented' AND d.lifecycle_state IN ('assigned', 'active') AND d.deleted_at IS NULL
     ORDER BY d.id`,
    [wo.contract_id],
  );
  return { workOrder: wo, units };
}

/**
 * Resolve one unit's pickup disposition: 'returned' -> in_stock (+1 stock,
 * ledger 'return' when the unit is linked to an inventory item) or
 * 'rma' -> rma (no stock change — it never crosses back into stock). Once
 * every outstanding rented unit on the contract is resolved, the work order
 * auto-completes.
 */
async function completePickupUnit({ workOrderId, cpeDeviceId, disposition, notes = null, orgId, performedBy = null }) {
  const [woRows] = await db.query(
    "SELECT * FROM work_orders WHERE id = ? AND organization_id = ? AND work_type = 'pickup' AND deleted_at IS NULL",
    [workOrderId, orgId],
  );
  const wo = woRows[0];
  if (!wo) throw new NotFoundError('Pickup work order');
  if (!wo.contract_id) throw new ValidationError('Pickup work order has no linked contract');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const execute = conn.execute.bind(conn);

    const [unitRows] = await execute(
      `SELECT * FROM cpe_devices
       WHERE id = ? AND contract_id = ? AND ownership = 'rented' AND lifecycle_state IN ('assigned', 'active')
         AND deleted_at IS NULL AND (organization_id = ? OR organization_id IS NULL)
       FOR UPDATE`,
      [cpeDeviceId, wo.contract_id, orgId],
    );
    const unit = unitRows[0];
    if (!unit) throw new ValidationError('This unit is not an outstanding rented device on this pickup order');

    const toState = disposition === 'returned' ? 'in_stock' : 'rma';
    await cpeInventoryService.transitionLifecycleState(unit.id, toState, {
      orgId, performedBy,
      reason: disposition === 'returned' ? `Pickup WO#${workOrderId}: returned to stock` : `Pickup WO#${workOrderId}: damaged/RMA`,
      connection: conn,
    });
    // The unit is no longer assigned to this contract/client either way.
    await execute(
      'UPDATE cpe_devices SET contract_id = NULL, subscriber_id = NULL, subscriber_linked_at = NULL, ownership = NULL WHERE id = ?',
      [unit.id],
    );

    // Only 'returned' crosses back into stock — 'rma' never does, so it gets
    // no stock/ledger write (consistency invariant, see module header).
    if (disposition === 'returned' && unit.inventory_item_id) {
      const stockId = await resolveOrCreateStockRow(execute, { orgId, itemId: unit.inventory_item_id });
      await execute('UPDATE inventory_stock SET quantity = quantity + 1 WHERE id = ?', [stockId]);
      await execute(
        `INSERT INTO inventory_transactions (stock_id, transaction_type, quantity, job_id, client_id, performed_by, reference, notes)
         VALUES (?, 'return', 1, ?, ?, ?, ?, ?)`,
        [stockId, workOrderId, wo.client_id, performedBy, `Pickup WO#${workOrderId}`, notes],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Auto-complete the pickup order once nothing rented remains outstanding.
  const [remaining] = await db.query(
    `SELECT COUNT(*) AS cnt FROM cpe_devices
     WHERE contract_id = ? AND ownership = 'rented' AND lifecycle_state IN ('assigned', 'active') AND deleted_at IS NULL`,
    [wo.contract_id],
  );
  if (Number(remaining[0].cnt) === 0) {
    await db.query("UPDATE work_orders SET status = 'completed', completed_at = NOW() WHERE id = ?", [workOrderId]);
  }

  const [rows] = await db.query('SELECT * FROM cpe_devices WHERE id = ?', [cpeDeviceId]);
  return rows[0];
}

module.exports = {
  createTrackedUnits,
  registerSerial,
  installEquipment,
  ensurePickupWorkOrder,
  getPickupChecklist,
  completePickupUnit,
};
