// =============================================================================
// FireISP 5.0 — Lifecycle Service Tests (§1.2)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const Lead = require('../src/models/Lead');
const Client = require('../src/models/Client');
const ServiceOrder = require('../src/models/ServiceOrder');
const lifecycleService = require('../src/services/lifecycleService');

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('generateOrderNumber', () => {
  test('zero-pads the next sequence for the org', async () => {
    const conn = { query: jest.fn().mockResolvedValue([[{ cnt: 41 }]]) };
    const num = await lifecycleService.generateOrderNumber(conn, 7);
    expect(num).toBe('SO-000042');
    expect(conn.query.mock.calls[0][1]).toEqual([7]);
  });
});

describe('convertLead', () => {
  test('creates a client, marks the lead won, and commits', async () => {
    jest.spyOn(Lead, 'findById')
      .mockResolvedValueOnce({ id: 5, name: 'Acme', email: 'a@b.com', company: 'Acme Inc', organization_id: 1, converted_client_id: null })
      .mockResolvedValueOnce({ id: 5, status: 'won', converted_client_id: 99 });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 99, name: 'Acme' });

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 99 }]) // INSERT clients
        .mockResolvedValueOnce([{ affectedRows: 1 }]), // UPDATE leads
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    const result = await lifecycleService.convertLead(5, 1, {});

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(result.client.id).toBe(99);
    expect(conn.query.mock.calls[0][0]).toMatch(/INSERT INTO clients/);
    expect(conn.query.mock.calls[1][0]).toMatch(/UPDATE leads SET status = 'won'/);
  });

  test('rejects converting a lead that is already converted', async () => {
    jest.spyOn(Lead, 'findById').mockResolvedValue({ id: 5, converted_client_id: 99 });
    await expect(lifecycleService.convertLead(5, 1)).rejects.toThrow(/already been converted/i);
  });

  test('throws NotFoundError when the lead does not exist', async () => {
    jest.spyOn(Lead, 'findById').mockResolvedValue(null);
    await expect(lifecycleService.convertLead(5, 1)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('transitionOrder', () => {
  test('rejects an invalid transition (requested → activated)', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'requested' });
    await expect(lifecycleService.transitionOrder(1, 'activated', { orgId: 1 }))
      .rejects.toThrow(/Invalid service order transition/);
  });

  test('approves a requested order and records approver', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'requested' });
    const updateSpy = jest.spyOn(ServiceOrder, 'update').mockResolvedValue({ id: 1, status: 'approved' });

    const result = await lifecycleService.transitionOrder(1, 'approved', { orgId: 1, userId: 9 });

    expect(result.status).toBe('approved');
    const updateArg = updateSpy.mock.calls[0][1];
    expect(updateArg.status).toBe('approved');
    expect(updateArg.approved_by).toBe(9);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('activates a provisioning order and emits service_order.activated', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'provisioning', client_id: 50 });
    jest.spyOn(ServiceOrder, 'update').mockResolvedValue({ id: 1, status: 'activated', order_number: 'SO-000001', client_id: 50 });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, email: 'c@d.com' });

    await lifecycleService.transitionOrder(1, 'activated', { orgId: 1, contractId: 77 });

    expect(eventBus.emit).toHaveBeenCalledWith('service_order.activated', expect.objectContaining({
      organizationId: 1,
      order: expect.objectContaining({ status: 'activated' }),
      client: expect.objectContaining({ id: 50 }),
    }));
  });
});

describe('churnReport', () => {
  test('computes churn rate per month', async () => {
    db.queryReplica.mockResolvedValue([[
      { month: '2026-05', new_contracts: 8, churned: 2 },
      { month: '2026-04', new_contracts: 0, churned: 0 },
    ]]);
    const report = await lifecycleService.churnReport(1, { months: 6 });
    expect(report.months[0]).toEqual({ month: '2026-05', new_contracts: 8, churned: 2, churn_rate_pct: 20 });
    expect(report.months[1].churn_rate_pct).toBe(0);
  });
});

describe('atRiskClients', () => {
  test('scores clients by suspended contracts and overdue invoices', async () => {
    db.queryReplica.mockResolvedValue([[
      { client_id: 1, name: 'A', email: 'a@x.com', suspended_contracts: 1, overdue_invoices: 2, max_days_overdue: 40 },
    ]]);
    const report = await lifecycleService.atRiskClients(1, {});
    // 1*40 + 2*15 + min(40,60)/2 = 40 + 30 + 20 = 90
    expect(report.clients[0].risk_score).toBe(90);
  });
});

describe('winbackTargets', () => {
  test('queries cancelled clients for the segment', async () => {
    db.queryReplica.mockResolvedValue([[{ client_id: 3, name: 'Gone', email: null, phone: '555' }]]);
    const rows = await lifecycleService.winbackTargets('cancelled_30d', 1);
    expect(rows).toHaveLength(1);
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/co\.status = 'cancelled'/);
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/INTERVAL 30 DAY/);
  });
});
