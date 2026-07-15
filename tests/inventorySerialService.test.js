// =============================================================================
// FireISP 5.0 — Inventory Phase 3: Serialized Equipment Service Tests
// =============================================================================
// Unit tests for src/services/inventorySerialService.js (migration 391).
// A single in-memory "database" object is shared by db.query AND every
// conn.execute/conn.query call (both dispatch through the same `route`
// function below), so writes made inside a transaction are visible to
// subsequent reads exactly like a real connection would see its own
// uncommitted work — order-independent substring matching, mirroring
// tests/purchaseOrders.test.js's buildConn pattern.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const inventorySerialService = require('../src/services/inventorySerialService');

function makeState(overrides = {}) {
  return {
    contracts: overrides.contracts ?? [{ id: 900, client_id: 100, organization_id: 42 }],
    serviceOrders: overrides.serviceOrders ?? [{ id: 5, contract_id: 900, organization_id: 42 }],
    items: overrides.items ?? [{ id: 1, organization_id: 42, name: 'ONU-X', sale_price: '150.00', unit_cost: '90.00', serial_required: 1 }],
    stock: overrides.stock ?? [{ id: 10, item_id: 1, warehouse_id: 5, quantity: 3 }],
    warehouses: overrides.warehouses ?? [{ id: 5, organization_id: 42 }],
    devices: overrides.devices ?? [],
    workOrders: overrides.workOrders ?? [],
    txns: [],
    nextDeviceId: 1000,
    nextStockId: 500,
    nextTxnId: 5000,
    nextWoId: 700,
    nextHistoryId: 9000,
  };
}

function route(sql, params, state) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const p = params || [];

  // --- _assertSerialNotTaken ---
  if (s.startsWith('SELECT id FROM cpe_devices WHERE serial_number = ?')) {
    const [serial] = p;
    const match = state.devices.find(d => d.serial_number === serial && !d._deleted);
    return Promise.resolve([match ? [{ id: match.id }] : []]);
  }

  // --- installEquipment: contract lookup ---
  if (s.startsWith('SELECT id, client_id, organization_id FROM contracts WHERE id = ?')) {
    const [id, orgId] = p;
    const c = state.contracts.find(c => c.id === id && (c.organization_id === orgId || c.organization_id === null));
    return Promise.resolve([c ? [c] : []]);
  }
  // --- ensurePickupWorkOrder: contract client_id lookup ---
  if (s.startsWith('SELECT client_id FROM contracts WHERE id = ?')) {
    const [id] = p;
    const c = state.contracts.find(c => c.id === id);
    return Promise.resolve([c ? [{ client_id: c.client_id }] : []]);
  }

  // --- installEquipment: service order check ---
  if (s.startsWith('SELECT id FROM service_orders WHERE id = ? AND contract_id = ?')) {
    const [soId, contractId, orgId] = p;
    const so = state.serviceOrders.find(o => o.id === soId && o.contract_id === contractId && (o.organization_id === orgId || o.organization_id === null));
    return Promise.resolve([so ? [{ id: so.id }] : []]);
  }

  // --- installEquipment: cpeDeviceId lookup, org-scoped, FOR UPDATE ---
  if (s.startsWith('SELECT * FROM cpe_devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL FOR UPDATE')) {
    const [id, orgId] = p;
    const d = state.devices.find(d => d.id === id && (d.organization_id === orgId || d.organization_id === null) && !d._deleted);
    return Promise.resolve([d ? [{ ...d }] : []]);
  }

  // --- completePickupUnit: outstanding-rented unit lookup, FOR UPDATE ---
  if (s.startsWith('SELECT * FROM cpe_devices WHERE id = ? AND contract_id = ? AND ownership = \'rented\' AND lifecycle_state IN (\'assigned\', \'active\') AND deleted_at IS NULL AND (organization_id = ? OR organization_id IS NULL) FOR UPDATE')) {
    const [id, contractId, orgId] = p;
    const d = state.devices.find(d => d.id === id && d.contract_id === contractId && d.ownership === 'rented'
      && ['assigned', 'active'].includes(d.lifecycle_state) && !d._deleted && (d.organization_id === orgId || d.organization_id === null));
    return Promise.resolve([d ? [{ ...d }] : []]);
  }

  // --- type-new-serial re-select FOR UPDATE (no org filter) / transitionLifecycleState's plain re-select ---
  if (s === 'SELECT * FROM cpe_devices WHERE id = ? FOR UPDATE' || s === 'SELECT * FROM cpe_devices WHERE id = ?') {
    const [id] = p;
    const d = state.devices.find(d => d.id === id);
    return Promise.resolve([d ? [{ ...d }] : []]);
  }

  // --- transitionLifecycleState internal: load current state ---
  if (s.startsWith('SELECT id, lifecycle_state, organization_id FROM cpe_devices WHERE id = ? AND deleted_at IS NULL')) {
    const [id] = p;
    const d = state.devices.find(d => d.id === id);
    return Promise.resolve([d ? [{ id: d.id, lifecycle_state: d.lifecycle_state, organization_id: d.organization_id }] : []]);
  }
  // --- transitionLifecycleState internal: apply state ---
  if (s.startsWith('UPDATE cpe_devices SET lifecycle_state = ? WHERE id = ?')) {
    const [toState, id] = p;
    const d = state.devices.find(d => d.id === id);
    if (d) d.lifecycle_state = toState;
    return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
  }
  // --- transitionLifecycleState internal: history insert ---
  if (s.startsWith('INSERT INTO cpe_lifecycle_history')) {
    return Promise.resolve([{ insertId: state.nextHistoryId++ }]);
  }

  // --- installEquipment: assign UPDATE (contract/subscriber/ownership) ---
  if (s.startsWith('UPDATE cpe_devices SET contract_id = ?, subscriber_id = ?, subscriber_linked_at = NOW(), ownership = ? WHERE id = ?')) {
    const [contractId, subscriberId, ownership, id] = p;
    const d = state.devices.find(d => d.id === id);
    if (d) { d.contract_id = contractId; d.subscriber_id = subscriberId; d.ownership = ownership; }
    return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
  }
  // --- completePickupUnit: clear-assignment UPDATE ---
  if (s.startsWith('UPDATE cpe_devices SET contract_id = NULL, subscriber_id = NULL, subscriber_linked_at = NULL, ownership = NULL WHERE id = ?')) {
    const [id] = p;
    const d = state.devices.find(d => d.id === id);
    if (d) { d.contract_id = null; d.subscriber_id = null; d.ownership = null; }
    return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
  }

  // --- createTrackedUnits / type-new-serial: INSERT cpe_devices (bare shape) ---
  if (s.startsWith('INSERT INTO cpe_devices (organization_id, serial_number, oui, inventory_item_id, lifecycle_state)')) {
    const [orgId, serial, itemId] = p;
    const id = state.nextDeviceId++;
    state.devices.push({ id, organization_id: orgId, serial_number: serial, oui: null, inventory_item_id: itemId, lifecycle_state: 'in_stock', contract_id: null, subscriber_id: null, ownership: null });
    return Promise.resolve([{ insertId: id }]);
  }
  // --- registerSerial: INSERT cpe_devices (full shape) ---
  if (s.startsWith('INSERT INTO cpe_devices (organization_id, serial_number, oui, manufacturer, model_name, inventory_item_id, lifecycle_state, notes)')) {
    const [orgId, serial, manufacturer, modelName, itemId, notes] = p;
    const id = state.nextDeviceId++;
    state.devices.push({ id, organization_id: orgId, serial_number: serial, oui: null, manufacturer, model_name: modelName, inventory_item_id: itemId, lifecycle_state: 'in_stock', notes, contract_id: null, subscriber_id: null, ownership: null });
    return Promise.resolve([{ insertId: id }]);
  }

  // --- _loadItem ---
  if (s.startsWith('SELECT * FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL')) {
    const [id, orgId] = p;
    const item = state.items.find(i => i.id === id && (i.organization_id === orgId || i.organization_id === null));
    return Promise.resolve([item ? [{ ...item }] : []]);
  }

  // --- _untrackedCapacity: SUM stock ---
  if (s.includes('COALESCE(SUM(s.quantity), 0) AS total')) {
    const [itemId] = p;
    const total = state.stock.filter(st => st.item_id === itemId).reduce((a, b) => a + b.quantity, 0);
    return Promise.resolve([[{ total }]]);
  }
  // --- _untrackedCapacity: COUNT tracked in_stock ---
  if (s.includes('COUNT(*) AS total FROM cpe_devices') && s.includes("lifecycle_state = 'in_stock'")) {
    const [itemId] = p;
    const total = state.devices.filter(d => d.inventory_item_id === itemId && d.lifecycle_state === 'in_stock' && !d._deleted).length;
    return Promise.resolve([[{ total }]]);
  }

  // --- resolveOrCreateStockRow: best existing stock row ---
  if (s.includes('SELECT s.id FROM inventory_stock s') && s.includes('ORDER BY s.quantity DESC')) {
    const [itemId] = p;
    const rows = state.stock.filter(st => st.item_id === itemId).sort((a, b) => b.quantity - a.quantity || a.id - b.id);
    return Promise.resolve([rows.length ? [{ id: rows[0].id }] : []]);
  }
  // --- registerSerial: org-verify the caller-specified warehouse (has an
  //     `id = ?` filter, unlike resolveOrCreateStockRow's first-warehouse
  //     lookup below) ---
  if (s.startsWith('SELECT id FROM warehouses WHERE id = ?')) {
    const [warehouseId, orgId] = p;
    const wh = state.warehouses.find(w => w.id === warehouseId && (w.organization_id === orgId || w.organization_id === null));
    return Promise.resolve([wh ? [{ id: wh.id }] : []]);
  }
  // --- resolveOrCreateStockRow: first warehouse ---
  if (s.startsWith('SELECT id FROM warehouses WHERE')) {
    const wh = state.warehouses[0];
    return Promise.resolve([wh ? [{ id: wh.id }] : []]);
  }
  // --- registerSerial: specific item+warehouse stock lookup ---
  if (s.startsWith('SELECT id FROM inventory_stock WHERE item_id = ? AND warehouse_id = ?')) {
    const [itemId, warehouseId] = p;
    const row = state.stock.find(st => st.item_id === itemId && st.warehouse_id === warehouseId);
    return Promise.resolve([row ? [{ id: row.id }] : []]);
  }
  // --- zero-qty stock row creation (shared by resolveOrCreateStockRow + registerSerial's specific-warehouse path) ---
  if (s === 'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, 0)') {
    const [itemId, warehouseId] = p;
    const id = state.nextStockId++;
    state.stock.push({ id, item_id: itemId, warehouse_id: warehouseId, quantity: 0 });
    return Promise.resolve([{ insertId: id }]);
  }

  // --- stock quantity adjustments ---
  if (s.startsWith('UPDATE inventory_stock SET quantity = quantity + 1 WHERE id = ?')) {
    const [id] = p;
    const row = state.stock.find(st => st.id === id);
    if (row) row.quantity += 1;
    return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
  }
  if (s.startsWith('UPDATE inventory_stock SET quantity = quantity - 1 WHERE id = ?')) {
    const [id] = p;
    const row = state.stock.find(st => st.id === id);
    if (row) row.quantity -= 1;
    return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
  }

  // --- ledger writes ---
  if (s.startsWith('INSERT INTO inventory_transactions')) {
    state.txns.push({ sql: s, params: p });
    return Promise.resolve([{ insertId: state.nextTxnId++ }]);
  }

  // --- ensurePickupWorkOrder: outstanding-rented check ---
  if (s.startsWith('SELECT id FROM cpe_devices') && s.includes("ownership = 'rented'") && s.includes('LIMIT 1')) {
    const [contractId] = p;
    const has = state.devices.some(d => d.contract_id === contractId && d.ownership === 'rented' && ['assigned', 'active'].includes(d.lifecycle_state) && !d._deleted);
    return Promise.resolve([has ? [{ id: 1 }] : []]);
  }
  // --- ensurePickupWorkOrder: existing open pickup order check ---
  if (s.startsWith('SELECT * FROM work_orders') && s.includes("work_type = 'pickup'") && s.includes('status NOT IN')) {
    const [contractId] = p;
    const wo = state.workOrders.find(w => w.contract_id === contractId && w.work_type === 'pickup' && !['completed', 'cancelled'].includes(w.status));
    return Promise.resolve([wo ? [{ ...wo }] : []]);
  }
  // --- ensurePickupWorkOrder: INSERT ---
  if (s.startsWith('INSERT INTO work_orders')) {
    const [orgId, clientId, contractId, title, description, performedBy] = p;
    const id = state.nextWoId++;
    state.workOrders.push({ id, organization_id: orgId, client_id: clientId, contract_id: contractId, title, description, status: 'pending', priority: 'medium', work_type: 'pickup', created_by: performedBy });
    return Promise.resolve([{ insertId: id }]);
  }
  // --- getPickupChecklist / completePickupUnit: work order lookup, org-scoped ---
  if (s.startsWith('SELECT * FROM work_orders WHERE id = ? AND organization_id = ?') && s.includes("work_type = 'pickup'")) {
    const [id, orgId] = p;
    const wo = state.workOrders.find(w => w.id === id && w.organization_id === orgId);
    return Promise.resolve([wo ? [{ ...wo }] : []]);
  }
  // --- generic work_order-by-id read (ensurePickupWorkOrder's final re-select) ---
  if (s === 'SELECT * FROM work_orders WHERE id = ?') {
    const [id] = p;
    const wo = state.workOrders.find(w => w.id === id);
    return Promise.resolve([wo ? [{ ...wo }] : []]);
  }
  // --- getPickupChecklist: units list ---
  if (s.includes('FROM cpe_devices d') && s.includes('LEFT JOIN inventory_items')) {
    const [contractId] = p;
    const units = state.devices.filter(d => d.contract_id === contractId && d.ownership === 'rented' && ['assigned', 'active'].includes(d.lifecycle_state) && !d._deleted);
    return Promise.resolve([units.map(d => ({ ...d }))]);
  }
  // --- completePickupUnit: remaining-outstanding COUNT ---
  if (s.startsWith('SELECT COUNT(*) AS cnt FROM cpe_devices')) {
    const [contractId] = p;
    const cnt = state.devices.filter(d => d.contract_id === contractId && d.ownership === 'rented' && ['assigned', 'active'].includes(d.lifecycle_state) && !d._deleted).length;
    return Promise.resolve([[{ cnt }]]);
  }
  // --- completePickupUnit: auto-complete UPDATE ---
  if (s.startsWith("UPDATE work_orders SET status = 'completed'")) {
    const [id] = p;
    const wo = state.workOrders.find(w => w.id === id);
    if (wo) wo.status = 'completed';
    return Promise.resolve([{ affectedRows: wo ? 1 : 0 }]);
  }

  return Promise.resolve([[]]);
}

function wireDb(state) {
  db.query.mockImplementation((sql, params) => route(sql, params, state));
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn((sql, params) => route(sql, params, state)),
    query: jest.fn((sql, params) => route(sql, params, state)),
  };
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

describe('inventorySerialService', () => {
  afterEach(() => jest.clearAllMocks());

  // ===========================================================================
  // registerSerial
  // ===========================================================================
  describe('registerSerial', () => {
    test('catch-up (default): registers a unit without touching inventory_stock.quantity', async () => {
      const state = makeState();
      wireDb(state);

      const device = await inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'LEGACY-001',
      });

      expect(device.serial_number).toBe('LEGACY-001');
      expect(device.lifecycle_state).toBe('in_stock');
      expect(state.stock.find(s => s.id === 10).quantity).toBe(3); // unchanged
      expect(state.txns).toHaveLength(0);
    });

    test('increment_stock=true: +1 quantity and a receive ledger row', async () => {
      const state = makeState();
      wireDb(state);

      await inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'NEW-001', incrementStock: true, performedBy: 7,
      });

      expect(state.stock.find(s => s.id === 10).quantity).toBe(4);
      expect(state.txns).toHaveLength(1);
      expect(state.txns[0].sql).toContain("'receive'");
    });

    test('rejects a duplicate serial number in the same org', async () => {
      const state = makeState({ devices: [{ id: 1, organization_id: 42, serial_number: 'DUP-1', inventory_item_id: 1, lifecycle_state: 'in_stock' }] });
      wireDb(state);

      await expect(inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'DUP-1',
      })).rejects.toThrow(/already registered/);
    });

    test('rejects an inventory_item_id from another organization', async () => {
      const state = makeState({ items: [{ id: 1, organization_id: 99, name: 'Foreign item', serial_required: 1 }] });
      wireDb(state);

      await expect(inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'X-1',
      })).rejects.toThrow(/does not belong to this organization/);
    });

    test('catch-up 422s once tracked in_stock units already match inventory_stock.quantity', async () => {
      // stock quantity 1, and ONE unit already tracked in_stock for this item
      // -> untracked capacity = 1 - 1 = 0. A second catch-up registration
      // would push tracked units past the physical quantity.
      const state = makeState({
        stock: [{ id: 10, item_id: 1, warehouse_id: 5, quantity: 1 }],
        devices: [{ id: 60, organization_id: 42, serial_number: 'ALREADY-TRACKED', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      wireDb(state);

      await expect(inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'OVER-CAPACITY',
      })).rejects.toThrow(/No untracked stock available/);

      // Nothing was written.
      expect(state.devices).toHaveLength(1);
      expect(state.stock.find(s => s.id === 10).quantity).toBe(1);
    });

    test('catch-up succeeds while untracked capacity remains', async () => {
      // stock quantity 3, zero tracked in_stock units -> capacity 3.
      const state = makeState();
      wireDb(state);

      const device = await inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'WITHIN-CAPACITY',
      });

      expect(device.serial_number).toBe('WITHIN-CAPACITY');
      expect(state.stock.find(s => s.id === 10).quantity).toBe(3); // catch-up never touches quantity
    });

    test('increment_stock=true is exempt from the untracked-capacity guard', async () => {
      // Capacity is already 0 (same setup as the 422 case above), but
      // increment_stock=true adds a genuinely new unit AND bumps quantity to
      // match, so it must not be blocked by the catch-up guard.
      const state = makeState({
        stock: [{ id: 10, item_id: 1, warehouse_id: 5, quantity: 1 }],
        devices: [{ id: 60, organization_id: 42, serial_number: 'ALREADY-TRACKED', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      wireDb(state);

      const device = await inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'GENUINELY-NEW', incrementStock: true,
      });

      expect(device.serial_number).toBe('GENUINELY-NEW');
      expect(state.stock.find(s => s.id === 10).quantity).toBe(2); // 1 -> 2
    });

    test('increment_stock with a cross-org warehouse_id 422s and writes nothing', async () => {
      const state = makeState({
        warehouses: [{ id: 5, organization_id: 99 }], // belongs to a different org
      });
      wireDb(state);

      await expect(inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'CROSS-ORG', warehouseId: 5, incrementStock: true,
      })).rejects.toThrow(/warehouse_id does not belong to this organization/);

      // Nothing was written — not the device, not the stock row.
      expect(state.devices).toHaveLength(0);
      expect(state.stock.find(s => s.id === 10).quantity).toBe(3);
    });

    test('increment_stock with an org-owned warehouse_id succeeds', async () => {
      const state = makeState();
      wireDb(state);

      await inventorySerialService.registerSerial({
        orgId: 42, itemId: 1, serialNumber: 'OWN-ORG-WH', warehouseId: 5, incrementStock: true,
      });

      expect(state.stock.find(s => s.id === 10).quantity).toBe(4); // 3 -> 4
    });
  });

  // ===========================================================================
  // installEquipment
  // ===========================================================================
  describe('installEquipment — rent', () => {
    test('decrements stock exactly once, writes assign_to_job, and assigns the unit', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-RENT', inventory_item_id: 1, lifecycle_state: 'in_stock', contract_id: null, subscriber_id: null, ownership: null }],
      });
      wireDb(state);

      const { unit, invoice } = await inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 50, ownership: 'rented', performedBy: 3,
      });

      expect(invoice).toBeNull();
      expect(unit.lifecycle_state).toBe('assigned');
      expect(unit.ownership).toBe('rented');
      expect(unit.contract_id).toBe(900);
      expect(unit.subscriber_id).toBe(100); // contract.client_id
      expect(state.stock.find(s => s.id === 10).quantity).toBe(2); // 3 -> 2
      expect(state.txns).toHaveLength(1);
      expect(state.txns[0].sql).toContain("'assign_to_job'");
    });

    test('rejects a unit that is not in_stock', async () => {
      const state = makeState({
        devices: [{ id: 51, organization_id: 42, serial_number: 'SN-ACTIVE', inventory_item_id: 1, lifecycle_state: 'active' }],
      });
      wireDb(state);

      await expect(inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 51, ownership: 'rented',
      })).rejects.toThrow(/not in stock/);
    });

    test('org-scope: 422s when contract_id belongs to another organization', async () => {
      const state = makeState({ contracts: [{ id: 900, client_id: 100, organization_id: 99 }] });
      wireDb(state);

      await expect(inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 50, ownership: 'rented',
      })).rejects.toThrow(/contract_id does not belong/);
    });

    test('org-scope: 422s when cpe_device_id belongs to another organization', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 99, serial_number: 'FOREIGN', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      wireDb(state);

      await expect(inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 50, ownership: 'rented',
      })).rejects.toThrow(/cpe_device_id does not belong/);
    });

    test('type-a-new-serial consumes untracked capacity when it exists', async () => {
      // stock quantity 3, zero tracked in_stock units -> 3 untracked units available
      const state = makeState();
      wireDb(state);

      const { unit } = await inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, newSerial: 'BOX-SERIAL', inventoryItemId: 1, ownership: 'rented',
      });

      expect(unit.serial_number).toBe('BOX-SERIAL');
      expect(unit.lifecycle_state).toBe('assigned');
      expect(state.stock.find(s => s.id === 10).quantity).toBe(2); // 3 -> 2 (one consumed)
    });

    test('type-a-new-serial 422s when there is no untracked capacity left', async () => {
      // stock quantity 1, and ONE unit already tracked in_stock for this item
      // -> untracked capacity = 1 - 1 = 0.
      const state = makeState({
        stock: [{ id: 10, item_id: 1, warehouse_id: 5, quantity: 1 }],
        devices: [{ id: 60, organization_id: 42, serial_number: 'ALREADY-TRACKED', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      wireDb(state);

      await expect(inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, newSerial: 'BOX-SERIAL-2', inventoryItemId: 1, ownership: 'rented',
      })).rejects.toThrow(/No untracked stock available/);

      // Nothing was written.
      expect(state.devices).toHaveLength(1);
      expect(state.stock.find(s => s.id === 10).quantity).toBe(1);
    });
  });

  describe('installEquipment — sold', () => {
    test('calls billingService.createOneOffInvoice exactly once with inventoryItemId, and does not itself touch inventory_stock', async () => {
      jest.resetModules();
      jest.doMock('../src/services/billingService', () => ({
        createOneOffInvoice: jest.fn().mockResolvedValue({ id: 1234, total: '150.00' }),
      }));
      const freshDb = require('../src/config/database');
      const freshBilling = require('../src/services/billingService');
      const freshService = require('../src/services/inventorySerialService');

      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-SOLD', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      freshDb.query.mockImplementation((sql, params) => route(sql, params, state));
      const conn = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
        execute: jest.fn((sql, params) => route(sql, params, state)),
        query: jest.fn((sql, params) => route(sql, params, state)),
      };
      freshDb.getConnection.mockResolvedValue(conn);

      const { unit, invoice } = await freshService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 50, ownership: 'sold', performedBy: 3,
      });

      expect(invoice).toEqual({ id: 1234, total: '150.00' });
      expect(unit.ownership).toBe('sold');
      expect(unit.lifecycle_state).toBe('assigned');
      expect(freshBilling.createOneOffInvoice).toHaveBeenCalledTimes(1);
      expect(freshBilling.createOneOffInvoice).toHaveBeenCalledWith(expect.objectContaining({
        orgId: 42, clientId: 100, contractId: 900, inventoryItemId: 1, amount: '150.00',
      }));
      // installEquipment's OWN code must never decrement stock for 'sold' —
      // that happens exactly once, inside the (here-mocked) createOneOffInvoice.
      const stockUpdates = [...conn.execute.mock.calls, ...conn.query.mock.calls]
        .filter(c => typeof c[0] === 'string' && c[0].includes('UPDATE inventory_stock'));
      expect(stockUpdates).toHaveLength(0);
      expect(state.stock.find(s => s.id === 10).quantity).toBe(3); // untouched by installEquipment itself

      jest.dontMock('../src/services/billingService');
    });

    test('422s when the item has neither sale_price nor unit_cost configured', async () => {
      const state = makeState({
        items: [{ id: 1, organization_id: 42, name: 'No-price item', sale_price: null, unit_cost: null, serial_required: 1 }],
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-NOPRICE', inventory_item_id: 1, lifecycle_state: 'in_stock' }],
      });
      wireDb(state);

      await expect(inventorySerialService.installEquipment({
        orgId: 42, contractId: 900, cpeDeviceId: 50, ownership: 'sold',
      })).rejects.toThrow(/no sale_price or unit_cost configured/);
    });
  });

  // ===========================================================================
  // Pickup — ensurePickupWorkOrder / completePickupUnit
  // ===========================================================================
  describe('ensurePickupWorkOrder', () => {
    test('creates a pickup work order when the contract has outstanding rented equipment', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-1', inventory_item_id: 1, lifecycle_state: 'assigned', contract_id: 900, ownership: 'rented' }],
      });
      wireDb(state);

      const wo = await inventorySerialService.ensurePickupWorkOrder(900, { orgId: 42, performedBy: 1 });

      expect(wo).not.toBeNull();
      expect(wo.work_type).toBe('pickup');
      expect(wo.contract_id).toBe(900);
      expect(state.workOrders).toHaveLength(1);
    });

    test('is idempotent — a second call does not create a duplicate pickup order', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-1', inventory_item_id: 1, lifecycle_state: 'assigned', contract_id: 900, ownership: 'rented' }],
      });
      wireDb(state);

      const first = await inventorySerialService.ensurePickupWorkOrder(900, { orgId: 42 });
      const second = await inventorySerialService.ensurePickupWorkOrder(900, { orgId: 42 });

      expect(state.workOrders).toHaveLength(1);
      expect(second.id).toBe(first.id);
    });

    test('is a no-op when nothing rented is outstanding (e.g. everything was sold)', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-1', inventory_item_id: 1, lifecycle_state: 'assigned', contract_id: 900, ownership: 'sold' }],
      });
      wireDb(state);

      const wo = await inventorySerialService.ensurePickupWorkOrder(900, { orgId: 42 });

      expect(wo).toBeNull();
      expect(state.workOrders).toHaveLength(0);
    });
  });

  describe('completePickupUnit', () => {
    function pickupState() {
      return makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-1', inventory_item_id: 1, lifecycle_state: 'assigned', contract_id: 900, ownership: 'rented' }],
        workOrders: [{ id: 700, organization_id: 42, client_id: 100, contract_id: 900, work_type: 'pickup', status: 'pending' }],
      });
    }

    test('returned: unit -> in_stock, stock +1, and a return ledger row', async () => {
      const state = pickupState();
      wireDb(state);

      const device = await inventorySerialService.completePickupUnit({
        workOrderId: 700, cpeDeviceId: 50, disposition: 'returned', orgId: 42, performedBy: 9,
      });

      expect(device.lifecycle_state).toBe('in_stock');
      expect(device.ownership).toBeNull();
      expect(device.contract_id).toBeNull();
      expect(state.stock.find(s => s.id === 10).quantity).toBe(4); // 3 -> 4
      expect(state.txns).toHaveLength(1);
      expect(state.txns[0].sql).toContain("'return'");
      // Nothing rented left -> the pickup work order auto-completes.
      expect(state.workOrders.find(w => w.id === 700).status).toBe('completed');
    });

    test('rma: unit -> rma, NO stock change, no ledger row', async () => {
      const state = pickupState();
      wireDb(state);

      const device = await inventorySerialService.completePickupUnit({
        workOrderId: 700, cpeDeviceId: 50, disposition: 'rma', orgId: 42, performedBy: 9,
      });

      expect(device.lifecycle_state).toBe('rma');
      expect(state.stock.find(s => s.id === 10).quantity).toBe(3); // unchanged
      expect(state.txns).toHaveLength(0);
      expect(state.workOrders.find(w => w.id === 700).status).toBe('completed');
    });

    test('does not auto-complete the work order while another rented unit is still outstanding', async () => {
      const state = pickupState();
      state.devices.push({ id: 51, organization_id: 42, serial_number: 'SN-2', inventory_item_id: 1, lifecycle_state: 'active', contract_id: 900, ownership: 'rented' });
      wireDb(state);

      await inventorySerialService.completePickupUnit({
        workOrderId: 700, cpeDeviceId: 50, disposition: 'returned', orgId: 42,
      });

      expect(state.workOrders.find(w => w.id === 700).status).toBe('pending');
    });

    test('org-scope: 422s when the unit is not an outstanding rented device on this pickup order', async () => {
      const state = pickupState();
      wireDb(state);

      await expect(inventorySerialService.completePickupUnit({
        workOrderId: 700, cpeDeviceId: 999, disposition: 'returned', orgId: 42,
      })).rejects.toThrow(/not an outstanding rented device/);
    });

    test('sold devices never appear as pickup-able — completing one 422s', async () => {
      const state = makeState({
        devices: [{ id: 50, organization_id: 42, serial_number: 'SN-SOLD', inventory_item_id: 1, lifecycle_state: 'assigned', contract_id: 900, ownership: 'sold' }],
        workOrders: [{ id: 700, organization_id: 42, client_id: 100, contract_id: 900, work_type: 'pickup', status: 'pending' }],
      });
      wireDb(state);

      await expect(inventorySerialService.completePickupUnit({
        workOrderId: 700, cpeDeviceId: 50, disposition: 'returned', orgId: 42,
      })).rejects.toThrow(/not an outstanding rented device/);
    });
  });
});
