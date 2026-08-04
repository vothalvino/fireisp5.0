'use strict';
// =============================================================================
// FireISP 5.0 — billing follow-up dispatcher (migration 445)
// =============================================================================
// A ticket for the billing team, N days after a service order completes, N per
// org via the billing_followup_days setting. Exactly once per order; 0
// disables; a follow-up >30 days overdue is skipped, never spammed.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const { dispatch } = require('../src/services/billingFollowupService');

const isSettings = (s) => /organization_settings/.test(s);
const isOrders   = (s) => /FROM service_orders so/.test(s);
const isInsert   = (s) => /INSERT INTO tickets/.test(s);
const isClaim    = (s) => /SET billing_followup_ticket_id = \?/.test(s);
const isCleanup  = (s) => /UPDATE tickets SET deleted_at/.test(s);

const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();

function order(over = {}) {
  return {
    id: 11, organization_id: 1, client_id: 5, contract_id: 7,
    order_number: 'SO-000011', completed_at: daysAgo(5), client_name: 'Acme',
    ...over,
  };
}

function wire({ settings = [], orders = [], claimRows = 1 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isSettings(sql)) return [settings];
    if (isOrders(sql)) return [orders];
    if (isInsert(sql)) return [{ insertId: 501, affectedRows: 1 }];
    if (isClaim(sql)) return [{ affectedRows: claimRows }];
    if (isCleanup(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
}

beforeEach(() => jest.clearAllMocks());

it('creates a billing/automation ticket for a due order and claims it on the service order', async () => {
  wire({ orders: [order()] }); // default delay 3, completed 5 days ago → due
  const result = await dispatch();
  expect(result.created).toBe(1);
  const ins = db.query.mock.calls.find(([s]) => isInsert(s));
  expect(ins[0]).toMatch(/'billing', 'automation'/);
  expect(ins[1][3]).toContain('SO-000011');
  const claim = db.query.mock.calls.find(([s]) => isClaim(s));
  expect(claim[0]).toMatch(/billing_followup_ticket_id IS NULL/); // guarded — exactly once
  expect(claim[1]).toEqual([501, 11]);
});

it('waits until the per-org delay has passed', async () => {
  // Org 1 configured to 10 days; order completed 5 days ago → not due.
  wire({ settings: [{ organization_id: 1, setting_value: '10' }], orders: [order()] });
  const result = await dispatch();
  expect(result.created).toBe(0);
  expect(db.query.mock.calls.some(([s]) => isInsert(s))).toBe(false);
});

it('0 disables the follow-up for that org', async () => {
  wire({ settings: [{ organization_id: 1, setting_value: '0' }], orders: [order()] });
  const result = await dispatch();
  expect(result.created).toBe(0);
});

it('skips (never spams) an order whose follow-up is more than 30 days overdue', async () => {
  wire({ orders: [order({ completed_at: daysAgo(60) })] }); // due at day 3, 57 days overdue
  const result = await dispatch();
  expect(result.created).toBe(0);
  expect(result.skipped_expired).toBe(1);
});

it('a lost claim race soft-deletes the duplicate ticket', async () => {
  wire({ orders: [order()], claimRows: 0 });
  const result = await dispatch();
  expect(result.created).toBe(0);
  expect(db.query.mock.calls.some(([s]) => isCleanup(s))).toBe(true);
});

it('a per-order failure does not stop the sweep', async () => {
  let first = true;
  db.query.mockImplementation(async (sql) => {
    if (isSettings(sql)) return [[]];
    if (isOrders(sql)) return [[order(), order({ id: 12, order_number: 'SO-000012' })]];
    if (isInsert(sql)) {
      if (first) { first = false; throw new Error('deadlock'); }
      return [{ insertId: 502 }];
    }
    if (isClaim(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const result = await dispatch();
  expect(result.created).toBe(1);
});
