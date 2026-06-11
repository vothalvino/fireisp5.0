// =============================================================================
// FireISP 5.0 — CPE Inventory Service Tests (§8.4)
// =============================================================================
'use strict';

const {
  assertTransitionAllowed,
  computeDepreciation,
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

  test('active → in_stock is NOT allowed', () => {
    expect(() => assertTransitionAllowed('active', 'in_stock')).toThrow(/not allowed/);
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
