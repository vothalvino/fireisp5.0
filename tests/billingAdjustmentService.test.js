// =============================================================================
// FireISP 5.0 — Billing Adjustment Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/auditLog', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const billingAdjustmentService = require('../src/services/billingAdjustmentService');

const MOCK_ADJUSTMENT = {
  id: 1,
  organization_id: 1,
  client_id: 5,
  entity_type: 'payment',
  entity_id: 20,
  adjustment_type: 'correction',
  amount_delta: 150.00,
  reason: 'Refund processed — request #10 (method: credit_balance)',
  approved_by: 3,
  created_by: 3,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('billingAdjustmentService.record()', () => {
  test('inserts billing_adjustment row and mirrors to audit_logs', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])      // INSERT billing_adjustments
      .mockResolvedValueOnce([[MOCK_ADJUSTMENT]]);    // SELECT after insert

    const result = await billingAdjustmentService.record({
      organizationId: 1,
      clientId: 5,
      entityType: 'payment',
      entityId: 20,
      adjustmentType: 'correction',
      amountDelta: 150,
      reason: 'Refund processed — request #10 (method: credit_balance)',
      approvedBy: 3,
      createdBy: 3,
    });

    expect(result).toMatchObject({ id: 1, client_id: 5 });
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create',
      tableName: 'billing_adjustments',
      recordId: 1,
    }));
  });

  test('propagates errors from db.query', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(billingAdjustmentService.record({
      organizationId: 1,
      clientId: 5,
      entityType: 'invoice',
      entityId: 10,
      adjustmentType: 'late_fee_waiver',
      amountDelta: 25,
      reason: 'Waiver approved by manager',
    })).rejects.toThrow('DB connection lost');
  });
});
