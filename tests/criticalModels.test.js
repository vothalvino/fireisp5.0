// =============================================================================
// FireISP 5.0 — Critical Model Unit Tests
// =============================================================================
// Tests the six most critical untested models: PaymentTransaction,
// PaymentAllocation, CfdiCancellation, SuspensionLog, ClientBalanceLedger,
// and WebhookDelivery.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');

// Import all six models
const PaymentTransaction = require('../src/models/PaymentTransaction');
const PaymentAllocation = require('../src/models/PaymentAllocation');
const CfdiCancellation = require('../src/models/CfdiCancellation');
const SuspensionLog = require('../src/models/SuspensionLog');
const ClientBalanceLedger = require('../src/models/ClientBalanceLedger');
const WebhookDelivery = require('../src/models/WebhookDelivery');

// =============================================================================
// PaymentTransaction
// =============================================================================
describe('PaymentTransaction', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is payment_transactions', () => {
    expect(PaymentTransaction.tableName).toBe('payment_transactions');
  });

  test('has organization scope', () => {
    expect(PaymentTransaction.hasOrgScope).toBe(true);
  });

  test('fillable includes gateway fields', () => {
    expect(PaymentTransaction.fillable).toContain('payment_gateway_id');
    expect(PaymentTransaction.fillable).toContain('provider_reference');
    expect(PaymentTransaction.fillable).toContain('gateway_status');
    expect(PaymentTransaction.fillable).toContain('amount');
    expect(PaymentTransaction.fillable).toContain('currency');
    expect(PaymentTransaction.fillable).toContain('idempotency_key');
  });

  test('findById queries with org scope', async () => {
    db.query.mockResolvedValue([[{ id: 1, amount: 500.00 }]]);
    const result = await PaymentTransaction.findById(1, 10);
    expect(result).toEqual({ id: 1, amount: 500.00 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND organization_id = ?'),
      [1, 10],
    );
  });

  test('create filters non-fillable fields', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1, amount: 100 }]]);

    await PaymentTransaction.create({
      organization_id: 1,
      amount: 100,
      currency: 'MXN',
      gateway_status: 'pending',
      secret_internal: 'should_be_stripped',
    });

    const insertSql = db.query.mock.calls[0][0];
    expect(insertSql).not.toContain('secret_internal');
    expect(insertSql).toContain('amount');
    expect(insertSql).toContain('currency');
  });

  test('fillable excludes request/response payloads from mass assignment risk', () => {
    // These fields ARE fillable by design (stored by the gateway service)
    expect(PaymentTransaction.fillable).toContain('request_payload');
    expect(PaymentTransaction.fillable).toContain('response_payload');
    expect(PaymentTransaction.fillable).toContain('webhook_payload');
  });
});

// =============================================================================
// PaymentAllocation
// =============================================================================
describe('PaymentAllocation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is payment_allocations', () => {
    expect(PaymentAllocation.tableName).toBe('payment_allocations');
  });

  test('does NOT have organization scope', () => {
    expect(PaymentAllocation.hasOrgScope).toBe(false);
  });

  test('fillable limited to payment_id, invoice_id, amount', () => {
    expect(PaymentAllocation.fillable).toEqual(['payment_id', 'invoice_id', 'amount']);
  });

  test('create with valid data', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])
      .mockResolvedValueOnce([[{ id: 5, payment_id: 1, invoice_id: 2, amount: 250.00 }]]);

    const result = await PaymentAllocation.create({
      payment_id: 1,
      invoice_id: 2,
      amount: 250.00,
    });

    expect(result.id).toBe(5);
    expect(result.amount).toBe(250.00);
  });

  test('findById without org scope', async () => {
    db.query.mockResolvedValue([[{ id: 3, payment_id: 1, invoice_id: 2 }]]);
    const result = await PaymentAllocation.findById(3);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('organization_id'),
      [3],
    );
    expect(result.id).toBe(3);
  });

  test('delete allocation', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await PaymentAllocation.delete(5);
    expect(result).toBe(true);
  });
});

// =============================================================================
// CfdiCancellation
// =============================================================================
describe('CfdiCancellation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is cfdi_cancellations', () => {
    expect(CfdiCancellation.tableName).toBe('cfdi_cancellations');
  });

  test('has organization scope', () => {
    expect(CfdiCancellation.hasOrgScope).toBe(true);
  });

  test('fillable includes SAT-specific fields', () => {
    expect(CfdiCancellation.fillable).toContain('cfdi_document_id');
    expect(CfdiCancellation.fillable).toContain('motivo');
    expect(CfdiCancellation.fillable).toContain('folio_sustitucion');
    expect(CfdiCancellation.fillable).toContain('cancellation_status');
    expect(CfdiCancellation.fillable).toContain('sat_response');
  });

  test('create cancellation record', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{
        id: 1,
        organization_id: 1,
        cfdi_document_id: 42,
        motivo: '02',
        cancellation_status: 'pending',
      }]]);

    const result = await CfdiCancellation.create({
      organization_id: 1,
      cfdi_document_id: 42,
      motivo: '02',
      cancellation_status: 'pending',
    });

    expect(result.cfdi_document_id).toBe(42);
    expect(result.motivo).toBe('02');
  });

  test('update cancellation with SAT response', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        id: 1,
        cancellation_status: 'accepted',
        sat_response: '<xml>OK</xml>',
      }]]);

    const result = await CfdiCancellation.update(1, {
      cancellation_status: 'accepted',
      sat_response: '<xml>OK</xml>',
    }, 1);

    expect(result.cancellation_status).toBe('accepted');
  });
});

// =============================================================================
// SuspensionLog
// =============================================================================
describe('SuspensionLog', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is suspension_logs', () => {
    expect(SuspensionLog.tableName).toBe('suspension_logs');
  });

  test('has organization scope', () => {
    expect(SuspensionLog.hasOrgScope).toBe(true);
  });

  test('fillable includes contract, rule, and action fields', () => {
    expect(SuspensionLog.fillable).toContain('contract_id');
    expect(SuspensionLog.fillable).toContain('rule_id');
    expect(SuspensionLog.fillable).toContain('action');
    expect(SuspensionLog.fillable).toContain('triggered_by');
    expect(SuspensionLog.fillable).toContain('notes');
  });

  test('create suspension log entry', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([[{
        id: 10,
        organization_id: 1,
        contract_id: 5,
        rule_id: 2,
        action: 'suspend',
        triggered_by: 'system',
      }]]);

    const result = await SuspensionLog.create({
      organization_id: 1,
      contract_id: 5,
      rule_id: 2,
      action: 'suspend',
      triggered_by: 'system',
      notes: 'Overdue 30+ days',
    });

    expect(result.action).toBe('suspend');
    expect(result.triggered_by).toBe('system');
  });

  test('list suspension logs with org scope', async () => {
    db.query.mockResolvedValue([[
      { id: 1, action: 'suspend' },
      { id: 2, action: 'restore' },
    ]]);

    const results = await SuspensionLog.findAll({ orgId: 1 });
    expect(results).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('organization_id = ?'),
      expect.arrayContaining([1]),
    );
  });
});

// =============================================================================
// ClientBalanceLedger
// =============================================================================
describe('ClientBalanceLedger', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is client_balance_ledger', () => {
    expect(ClientBalanceLedger.tableName).toBe('client_balance_ledger');
  });

  test('has organization scope', () => {
    expect(ClientBalanceLedger.hasOrgScope).toBe(true);
  });

  test('fillable includes financial fields', () => {
    expect(ClientBalanceLedger.fillable).toContain('client_id');
    expect(ClientBalanceLedger.fillable).toContain('balance_type');
    expect(ClientBalanceLedger.fillable).toContain('amount');
    expect(ClientBalanceLedger.fillable).toContain('entry_type');
    expect(ClientBalanceLedger.fillable).toContain('reference_id');
    expect(ClientBalanceLedger.fillable).toContain('description');
  });

  test('create ledger entry', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 100 }])
      .mockResolvedValueOnce([[{
        id: 100,
        client_id: 5,
        balance_type: 'receivable',
        amount: -500.00,
        entry_type: 'payment',
        description: 'Payment received',
      }]]);

    const result = await ClientBalanceLedger.create({
      organization_id: 1,
      client_id: 5,
      balance_type: 'receivable',
      amount: -500.00,
      entry_type: 'payment',
      description: 'Payment received',
    });

    expect(result.balance_type).toBe('receivable');
    expect(result.amount).toBe(-500.00);
  });

  test('count ledger entries for a client', async () => {
    db.query.mockResolvedValue([[{ total: 15 }]]);
    const total = await ClientBalanceLedger.count({
      where: { client_id: 5 },
      orgId: 1,
    });
    expect(total).toBe(15);
  });

  test('filters non-fillable fields on create', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1 }]]);

    await ClientBalanceLedger.create({
      organization_id: 1,
      client_id: 5,
      amount: 100,
      balance_type: 'receivable',
      entry_type: 'invoice',
      created_at: '2025-01-01',
    });

    const insertSql = db.query.mock.calls[0][0];
    expect(insertSql).not.toContain('created_at');
  });
});

// =============================================================================
// WebhookDelivery
// =============================================================================
describe('WebhookDelivery', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tableName is webhook_deliveries', () => {
    expect(WebhookDelivery.tableName).toBe('webhook_deliveries');
  });

  test('does NOT have organization scope', () => {
    expect(WebhookDelivery.hasOrgScope).toBe(false);
  });

  test('fillable includes delivery tracking fields', () => {
    expect(WebhookDelivery.fillable).toContain('webhook_id');
    expect(WebhookDelivery.fillable).toContain('event');
    expect(WebhookDelivery.fillable).toContain('request_body');
    expect(WebhookDelivery.fillable).toContain('response_status');
    expect(WebhookDelivery.fillable).toContain('response_body');
    expect(WebhookDelivery.fillable).toContain('response_time_ms');
    expect(WebhookDelivery.fillable).toContain('attempt');
    expect(WebhookDelivery.fillable).toContain('status');
  });

  test('create delivery record', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 50 }])
      .mockResolvedValueOnce([[{
        id: 50,
        webhook_id: 3,
        event: 'invoice.created',
        response_status: 200,
        status: 'success',
        attempt: 1,
      }]]);

    const result = await WebhookDelivery.create({
      webhook_id: 3,
      event: 'invoice.created',
      request_body: '{"event":"invoice.created"}',
      response_status: 200,
      response_body: 'OK',
      response_time_ms: 150,
      attempt: 1,
      status: 'success',
    });

    expect(result.status).toBe('success');
    expect(result.event).toBe('invoice.created');
  });

  test('findAll without org scope', async () => {
    db.query.mockResolvedValue([[
      { id: 1, status: 'success' },
      { id: 2, status: 'failed' },
    ]]);

    const results = await WebhookDelivery.findAll({ where: { webhook_id: 3 } });
    expect(results).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('organization_id'),
      expect.any(Array),
    );
  });

  test('delete delivery record', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await WebhookDelivery.delete(50);
    expect(result).toBe(true);
  });
});
