// =============================================================================
// FireISP 5.0 — Client-Group Shared Billing Service Tests
// =============================================================================
// Covers groupBillingService.getGroupBilling + payGroup: the primary pays the
// group's balance and it FIFO-allocates across members' open invoices. Money
// movement, so the coverage is deliberately adversarial (partial pay, overpay,
// over-allocation guard, non-shared/no-primary rejection, FIFO order across
// members).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/models/ClientGroup', () => ({
  findById: jest.fn(),
  getMembers: jest.fn(),
}));

jest.mock('../src/models/Organization', () => ({
  getCurrency: jest.fn(async () => 'MXN'),
}));

jest.mock('../src/services/clientBalanceService', () => ({
  computeClientBalance: jest.fn(),
}));

const mockGetInvoices = jest.fn();
const mockFinalize = jest.fn(async () => false);
const mockReconnect = jest.fn(async () => {});
jest.mock('../src/services/paymentAllocationService', () => ({
  getInvoicesWithBalance: (...a) => mockGetInvoices(...a),
  finalizeIfFullyPaid: (...a) => mockFinalize(...a),
  reconnectIfSuspended: (...a) => mockReconnect(...a),
}));

const mockRecordCredit = jest.fn(async () => {});
jest.mock('../src/services/billingService', () => ({
  recordPaymentCredit: (...a) => mockRecordCredit(...a),
}));

const db = require('../src/config/database');
const ClientGroup = require('../src/models/ClientGroup');
const { computeClientBalance } = require('../src/services/clientBalanceService');
const groupBillingService = require('../src/services/groupBillingService');

// A fake transaction connection. execute() dispatches on SQL: it mints a
// payment id, records every allocation insert, and can be told to throw the
// over-allocation trigger error on the Nth allocation.
function makeConn({ throwOn = null } = {}) {
  const conn = {
    allocations: [],
    committed: false,
    rolledBack: false,
    released: false,
    _allocN: 0,
    async beginTransaction() {},
    async execute(sql, params) {
      if (sql.includes('INSERT INTO payments')) return [{ insertId: 900 }];
      if (sql.includes('INSERT INTO payment_allocations')) {
        conn._allocN += 1;
        if (throwOn === conn._allocN) {
          const e = new Error('over'); e.sqlState = '45000'; throw e;
        }
        conn.allocations.push({ payment_id: params[0], invoice_id: params[1], amount: params[2] });
        return [{ insertId: 1000 + conn._allocN }];
      }
      return [[]];
    },
    async commit() { this.committed = true; },
    async rollback() { this.rolledBack = true; },
    release() { this.released = true; },
  };
  return conn;
}

const GROUP = { id: 7, name: 'Familia Pérez', billing_mode: 'shared', primary_client_id: 1 };
const MEMBERS = [
  { id: 1, name: 'Ana (primary)' },
  { id: 2, name: 'Beto' },
  { id: 3, name: 'Carla' },
];

// Invoices oldest→newest across members: primary's is NOT the oldest, to prove
// FIFO spans members by date, not by member order.
const INVOICES = {
  1: [{ id: 101, invoice_number: 'INV-101', client_id: 1, issue_date: '2026-03-01', total: '100.00', balance_due: '100.00', currency: 'MXN' }],
  2: [{ id: 201, invoice_number: 'INV-201', client_id: 2, issue_date: '2026-01-15', total: '50.00', balance_due: '50.00', currency: 'MXN' }],
  3: [{ id: 301, invoice_number: 'INV-301', client_id: 3, issue_date: '2026-02-10', total: '30.00', balance_due: '30.00', currency: 'MXN' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  ClientGroup.findById.mockResolvedValue({ ...GROUP });
  ClientGroup.getMembers.mockResolvedValue(MEMBERS.map((m) => ({ ...m })));
  mockGetInvoices.mockImplementation(async (_exec, _org, clientId) =>
    (INVOICES[clientId] || []).map((r) => ({ ...r })));
  computeClientBalance.mockImplementation(async (_org, clientId) => ({
    balance: { 1: 100, 2: 50, 3: 30 }[clientId] || 0, currency: 'MXN',
  }));
  mockFinalize.mockResolvedValue(true);
  db.getConnection.mockResolvedValue(makeConn());
});

describe('getGroupBilling', () => {
  it('returns per-member balances, group total, and merged FIFO open invoices', async () => {
    const res = await groupBillingService.getGroupBilling(10, 7);
    expect(res.group_balance).toBe(180);
    expect(res.payable_total).toBe(180);
    expect(res.members.find((m) => m.client_id === 1).is_primary).toBe(true);
    // Merged oldest→newest across members: Beto(01-15) → Carla(02-10) → Ana(03-01)
    expect(res.open_invoices.map((i) => i.invoice_number)).toEqual(['INV-201', 'INV-301', 'INV-101']);
  });

  it('rejects a non-shared group with 422', async () => {
    ClientGroup.findById.mockResolvedValue({ ...GROUP, billing_mode: 'separate' });
    await expect(groupBillingService.getGroupBilling(10, 7)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a shared group with no primary designated', async () => {
    ClientGroup.findById.mockResolvedValue({ ...GROUP, primary_client_id: null });
    await expect(groupBillingService.getGroupBilling(10, 7)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('404s an unknown group', async () => {
    ClientGroup.findById.mockResolvedValue(null);
    await expect(groupBillingService.getGroupBilling(10, 7)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('payGroup', () => {
  it('pays the full group balance FIFO across members, recording the payment on the primary', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);

    const res = await groupBillingService.payGroup(10, 7, { payment_method: 'cash', actorUserId: 5 });

    expect(conn.committed).toBe(true);
    expect(res.payment.client_id).toBe(1); // primary
    expect(res.payment.amount).toBe(180);
    expect(res.allocated_total).toBe(180);
    expect(res.unallocated_credit).toBe(0);
    // FIFO order: 201(50) → 301(30) → 101(100)
    expect(conn.allocations.map((a) => a.invoice_id)).toEqual([201, 301, 101]);
    expect(conn.allocations.map((a) => a.amount)).toEqual([50, 30, 100]);
    expect(res.settled_invoices).toHaveLength(3);
    expect(mockRecordCredit).toHaveBeenCalledTimes(1);
  });

  it('partial amount settles oldest first and stops when exhausted', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);

    const res = await groupBillingService.payGroup(10, 7, { amount: 70 });
    // 70 covers INV-201 (50) fully, then 20 of INV-301 (30); INV-101 untouched.
    expect(conn.allocations.map((a) => [a.invoice_id, a.amount])).toEqual([[201, 50], [301, 20]]);
    expect(res.allocated_total).toBe(70);
    expect(res.unallocated_credit).toBe(0);
  });

  it('overpayment leaves unallocated credit on the primary', async () => {
    const conn = makeConn();
    db.getConnection.mockResolvedValue(conn);

    const res = await groupBillingService.payGroup(10, 7, { amount: 250 });
    expect(res.allocated_total).toBe(180);
    expect(res.unallocated_credit).toBe(70);
  });

  it('maps the over-allocation trigger to a 422 and rolls back', async () => {
    const conn = makeConn({ throwOn: 1 });
    db.getConnection.mockResolvedValue(conn);

    await expect(groupBillingService.payGroup(10, 7, {})).rejects.toMatchObject({ statusCode: 422 });
    expect(conn.rolledBack).toBe(true);
    expect(conn.released).toBe(true);
  });

  it('rejects paying a group with no open balance', async () => {
    mockGetInvoices.mockResolvedValue([]); // no open invoices anywhere
    await expect(groupBillingService.payGroup(10, 7, {})).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects an explicit non-positive amount', async () => {
    await expect(groupBillingService.payGroup(10, 7, { amount: 0 })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects invoice_ids that are not open invoices for the group', async () => {
    await expect(groupBillingService.payGroup(10, 7, { invoice_ids: [999] })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('is refused for a non-shared group before any money moves', async () => {
    ClientGroup.findById.mockResolvedValue({ ...GROUP, billing_mode: 'separate' });
    await expect(groupBillingService.payGroup(10, 7, {})).rejects.toMatchObject({ statusCode: 422 });
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});
