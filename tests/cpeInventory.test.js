// =============================================================================
// FireISP 5.0 — CPE Inventory Service Tests (§8.4)
// =============================================================================
'use strict';

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
const {
  assertTransitionAllowed,
  computeDepreciation,
  swapDevice,
  TRANSITIONS,
} = require('../src/services/cpeInventoryService');

// ---------------------------------------------------------------------------
// Lifecycle FSM transitions
// ---------------------------------------------------------------------------

describe('cpeInventoryService lifecycle FSM', () => {
  test('in_stock → assigned is allowed', () => {
    expect(() => assertTransitionAllowed('in_stock', 'assigned')).not.toThrow();
  });

  test('assigned → active is allowed', () => {
    expect(() => assertTransitionAllowed('assigned', 'active')).not.toThrow();
  });

  test('active → returned is allowed', () => {
    expect(() => assertTransitionAllowed('active', 'returned')).not.toThrow();
  });

  test('active → rma is allowed', () => {
    expect(() => assertTransitionAllowed('active', 'rma')).not.toThrow();
  });

  test('returned → in_stock is allowed', () => {
    expect(() => assertTransitionAllowed('returned', 'in_stock')).not.toThrow();
  });

  test('rma → in_stock is allowed', () => {
    expect(() => assertTransitionAllowed('rma', 'in_stock')).not.toThrow();
  });

  test('in_stock → active is NOT allowed', () => {
    expect(() => assertTransitionAllowed('in_stock', 'active')).toThrow(/not allowed/);
  });

  // Migration 392 follow-up: undo-install needs a direct active -> in_stock
  // path (a unit that already came online can still be undone on a live
  // contract, not just one still 'assigned') — see inventorySerialService.
  // uninstallEquipment and TRANSITIONS.active's comment.
  test('active → in_stock is allowed (undo-install)', () => {
    expect(() => assertTransitionAllowed('active', 'in_stock')).not.toThrow();
  });

  test('in_stock → rma is NOT allowed', () => {
    expect(() => assertTransitionAllowed('in_stock', 'rma')).toThrow(/not allowed/);
  });

  test('TRANSITIONS map covers all lifecycle states', () => {
    const states = ['in_stock', 'assigned', 'active', 'returned', 'rma'];
    for (const s of states) {
      expect(TRANSITIONS).toHaveProperty(s);
      expect(Array.isArray(TRANSITIONS[s])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Depreciation calculations
// ---------------------------------------------------------------------------

describe('cpeInventoryService depreciation — straight_line', () => {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const device = {
    purchase_cost: 1000,
    purchase_date: twoYearsAgo.toISOString().slice(0, 10),
    depreciation_method: 'straight_line',
    useful_life_months: 60,  // 5 years
    salvage_value: 0,
  };

  test('returns currentValue and accumulatedDepreciation', () => {
    const result = computeDepreciation(device);
    expect(result.currentValue).not.toBeNull();
    expect(result.accumulatedDepreciation).not.toBeNull();
    expect(result.method).toBe('straight_line');
  });

  test('straight-line: currentValue is less than purchase_cost after 2 years', () => {
    const result = computeDepreciation(device);
    expect(result.currentValue).toBeLessThan(1000);
    expect(result.currentValue).toBeGreaterThan(0);
  });

  test('straight-line: depreciation is ~$400 after 2 of 5 years', () => {
    const result = computeDepreciation(device);
    // 2/5 years → $400 depreciated → $600 remaining (approx, within $50 for month boundary)
    expect(result.accumulatedDepreciation).toBeGreaterThan(350);
    expect(result.accumulatedDepreciation).toBeLessThan(450);
  });

  test('straight-line: elapsedMonths is approximately 24', () => {
    const result = computeDepreciation(device);
    expect(result.elapsedMonths).toBeGreaterThanOrEqual(23);
    expect(result.elapsedMonths).toBeLessThanOrEqual(25);
  });

  test('straight-line: remainingMonths is approximately 36', () => {
    const result = computeDepreciation(device);
    expect(result.remainingMonths).toBeGreaterThanOrEqual(35);
    expect(result.remainingMonths).toBeLessThanOrEqual(37);
  });

  test('respects salvage_value floor', () => {
    const d = { ...device, salvage_value: 200, useful_life_months: 1 };
    const result = computeDepreciation(d);
    expect(result.currentValue).toBeGreaterThanOrEqual(200);
  });
});

describe('cpeInventoryService depreciation — declining_balance', () => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const device = {
    purchase_cost: 1000,
    purchase_date: oneYearAgo.toISOString().slice(0, 10),
    depreciation_method: 'declining_balance',
    useful_life_months: 60,
    salvage_value: 0,
  };

  test('returns currentValue less than purchase_cost', () => {
    const result = computeDepreciation(device);
    expect(result.currentValue).toBeLessThan(1000);
  });

  test('method is declining_balance', () => {
    const result = computeDepreciation(device);
    expect(result.method).toBe('declining_balance');
  });
});

describe('cpeInventoryService depreciation — none / missing data', () => {
  test('returns null values when method is none', () => {
    const result = computeDepreciation({
      purchase_cost: 500,
      purchase_date: '2024-01-01',
      depreciation_method: 'none',
      useful_life_months: 60,
      salvage_value: 0,
    });
    expect(result.currentValue).toBeNull();
    expect(result.accumulatedDepreciation).toBeNull();
  });

  test('returns null values when purchase_cost is null', () => {
    const result = computeDepreciation({
      purchase_cost: null,
      purchase_date: '2024-01-01',
      depreciation_method: 'straight_line',
      useful_life_months: 60,
      salvage_value: 0,
    });
    expect(result.currentValue).toBeNull();
  });

  test('returns null values when purchase_date is null', () => {
    const result = computeDepreciation({
      purchase_cost: 500,
      purchase_date: null,
      depreciation_method: 'straight_line',
      useful_life_months: 60,
      salvage_value: 0,
    });
    expect(result.currentValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// swapDevice — stock effects (Inventory Phase 3 hardening: swap must move
// inventory_stock/inventory_transactions for the incoming device exactly
// like installEquipment does, not leak a tracked unit out of stock)
// ---------------------------------------------------------------------------

describe('swapDevice — stock effects', () => {
  function makeState(overrides = {}) {
    return {
      devices: overrides.devices ?? [],
      stock: overrides.stock ?? [{ id: 10, item_id: 1, warehouse_id: 5, quantity: 3 }],
      warehouses: overrides.warehouses ?? [{ id: 5, organization_id: 42 }],
      txns: [],
      history: [],
      nextHistoryId: 9000,
    };
  }

  function route(sql, params, state) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    const p = params || [];

    // swapDevice: load old/new device (full row, org-agnostic — swapDevice
    // itself doesn't org-filter this particular SELECT)
    if (s === 'SELECT * FROM cpe_devices WHERE id = ? AND deleted_at IS NULL') {
      const [id] = p;
      const d = state.devices.find(dev => dev.id === id && !dev._deleted);
      return Promise.resolve([d ? [{ ...d }] : []]);
    }

    // transitionLifecycleState: load current state
    if (s === 'SELECT id, lifecycle_state, organization_id FROM cpe_devices WHERE id = ? AND deleted_at IS NULL') {
      const [id] = p;
      const d = state.devices.find(dev => dev.id === id);
      return Promise.resolve([d ? [{ id: d.id, lifecycle_state: d.lifecycle_state, organization_id: d.organization_id }] : []]);
    }

    // transitionLifecycleState: apply state
    if (s === 'UPDATE cpe_devices SET lifecycle_state = ? WHERE id = ?') {
      const [toState, id] = p;
      const d = state.devices.find(dev => dev.id === id);
      if (d) d.lifecycle_state = toState;
      return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
    }

    // transitionLifecycleState: history insert
    if (s.startsWith('INSERT INTO cpe_lifecycle_history')) {
      state.history.push({ sql: s, params: p });
      return Promise.resolve([{ insertId: state.nextHistoryId++ }]);
    }

    // generic device-by-id reselect (no deleted_at clause) — used by
    // transitionLifecycleState's own return AND swapDevice's post-commit
    // reselects.
    if (s === 'SELECT * FROM cpe_devices WHERE id = ?') {
      const [id] = p;
      const d = state.devices.find(dev => dev.id === id);
      return Promise.resolve([d ? [{ ...d }] : []]);
    }

    // swapDevice: inherit subscriber/profile/contract/ownership onto the new device
    if (s.startsWith('UPDATE cpe_devices SET subscriber_id = ?, subscriber_linked_at = NOW(), cpe_profile_id = ?, contract_id = ?, ownership = ?')) {
      const [subscriberId, cpeProfileId, contractId, ownership, id] = p;
      const d = state.devices.find(dev => dev.id === id);
      if (d) { d.subscriber_id = subscriberId; d.cpe_profile_id = cpeProfileId; d.contract_id = contractId; d.ownership = ownership; }
      return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
    }

    // swapDevice: clear old device link
    if (s === 'UPDATE cpe_devices SET subscriber_id = NULL, subscriber_linked_at = NULL, contract_id = NULL WHERE id = ?') {
      const [id] = p;
      const d = state.devices.find(dev => dev.id === id);
      if (d) { d.subscriber_id = null; d.contract_id = null; }
      return Promise.resolve([{ affectedRows: d ? 1 : 0 }]);
    }

    // resolveOrCreateStockRow: best existing stock row
    if (s.includes('SELECT s.id FROM inventory_stock s') && s.includes('ORDER BY s.quantity DESC')) {
      const [itemId] = p;
      const rows = state.stock.filter(st => st.item_id === itemId).sort((a, b) => b.quantity - a.quantity || a.id - b.id);
      return Promise.resolve([rows.length ? [{ id: rows[0].id }] : []]);
    }
    // resolveOrCreateStockRow: fallback first warehouse (only reached if no stock row exists yet)
    if (s.startsWith('SELECT id FROM warehouses WHERE')) {
      const wh = state.warehouses[0];
      return Promise.resolve([wh ? [{ id: wh.id }] : []]);
    }
    if (s === 'INSERT INTO inventory_stock (item_id, warehouse_id, quantity) VALUES (?, ?, 0)') {
      const [itemId, warehouseId] = p;
      const id = (state.nextStockId = (state.nextStockId || 500) + 1);
      state.stock.push({ id, item_id: itemId, warehouse_id: warehouseId, quantity: 0 });
      return Promise.resolve([{ insertId: id }]);
    }

    if (s.startsWith('UPDATE inventory_stock SET quantity = quantity - 1 WHERE id = ?')) {
      const [id] = p;
      const row = state.stock.find(st => st.id === id);
      if (row) row.quantity -= 1;
      return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
    }

    if (s.startsWith('INSERT INTO inventory_transactions')) {
      state.txns.push({ sql: s, params: p });
      return Promise.resolve([{ insertId: 5000 + state.txns.length }]);
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
      query: jest.fn((sql, params) => route(sql, params, state)),
    };
    db.getConnection.mockResolvedValue(conn);
    return conn;
  }

  afterEach(() => jest.clearAllMocks());

  test('swap of a linked unit: decrements stock, writes assign_to_job ledger, and carries ownership/contract/subscriber to the new device', async () => {
    const state = makeState({
      devices: [
        { id: 1, organization_id: 42, serial_number: 'OLD-SN', lifecycle_state: 'assigned', subscriber_id: 100, cpe_profile_id: 7, contract_id: 900, ownership: 'rented', inventory_item_id: null },
        { id: 2, organization_id: 42, serial_number: 'NEW-SN', lifecycle_state: 'in_stock', subscriber_id: null, cpe_profile_id: null, contract_id: null, ownership: null, inventory_item_id: 1 },
      ],
    });
    const conn = wireDb(state);

    const { oldDevice, newDevice } = await swapDevice({
      oldDeviceId: 1, newDeviceId: 2, orgId: 42, performedBy: 9, reason: 'Faulty unit',
    });

    // New device: assigned, and carries the old device's ownership/contract/subscriber.
    expect(newDevice.lifecycle_state).toBe('assigned');
    expect(newDevice.ownership).toBe('rented');
    expect(newDevice.contract_id).toBe(900);
    expect(newDevice.subscriber_id).toBe(100);

    // Old device: returned, unlinked — but per the consistency invariant,
    // 'returned' does NOT re-enter stock until a pickup/return flow resolves it.
    expect(oldDevice.lifecycle_state).toBe('returned');
    expect(oldDevice.subscriber_id).toBeNull();
    expect(oldDevice.contract_id).toBeNull();

    // Stock decremented exactly once, for the NEW device's tracked item.
    expect(state.stock.find(row => row.id === 10).quantity).toBe(2); // 3 -> 2
    expect(state.txns).toHaveLength(1);
    expect(state.txns[0].sql).toContain("'assign_to_job'");
    expect(state.txns[0].params).toEqual([10, 100, 9, 'CPE swap on contract #900', 'Serial NEW-SN (swap-in)']);

    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  test('swap of a non-linked (untracked) unit: stock is left untouched, no ledger row', async () => {
    const state = makeState({
      devices: [
        { id: 1, organization_id: 42, serial_number: 'OLD-SN', lifecycle_state: 'assigned', subscriber_id: 100, cpe_profile_id: 7, contract_id: 900, ownership: 'rented', inventory_item_id: null },
        { id: 2, organization_id: 42, serial_number: 'NEW-SN-UNTRACKED', lifecycle_state: 'in_stock', subscriber_id: null, cpe_profile_id: null, contract_id: null, ownership: null, inventory_item_id: null },
      ],
    });
    wireDb(state);

    const { newDevice } = await swapDevice({
      oldDeviceId: 1, newDeviceId: 2, orgId: 42, performedBy: 9,
    });

    expect(newDevice.lifecycle_state).toBe('assigned');
    expect(newDevice.ownership).toBe('rented'); // still carried, even though there's no stock to move
    expect(state.txns).toHaveLength(0);
    expect(state.stock.find(row => row.id === 10).quantity).toBe(3); // unchanged
  });
});
