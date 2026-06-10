// =============================================================================
// FireISP 5.0 — Refund Request Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../src/services/billingAdjustmentService', () => ({
  record: jest.fn().mockResolvedValue({ id: 1 }),
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
const eventBus = require('../src/services/eventBus');
const billingAdjustmentService = require('../src/services/billingAdjustmentService');
const refundRequestService = require('../src/services/refundRequestService');

const MOCK_REQUEST = {
  id: 10,
  organization_id: 1,
  client_id: 5,
  payment_id: 20,
  invoice_id: 30,
  amount: '150.00',
  reason: 'overcharge',
  status: 'requested',
  requested_by: 2,
  reviewed_by: null,
  review_notes: null,
  processed_at: null,
  refund_method: null,
  gateway_refund_reference: null,
  resulting_credit_note_id: null,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// createRequest
// =============================================================================
describe('createRequest', () => {
  test('creates a row and emits refund.requested', async () => {
    const insertId = 10;
    db.query
      .mockResolvedValueOnce([{ insertId }])    // RefundRequest.create insert
      .mockResolvedValueOnce([[MOCK_REQUEST]]);  // SELECT after insert

    const result = await refundRequestService.createRequest(1, {
      client_id: 5,
      payment_id: 20,
      amount: 150,
      reason: 'overcharge',
    }, 2);

    expect(result).toMatchObject({ id: 10, status: 'requested' });
    expect(eventBus.emit).toHaveBeenCalledWith('refund.requested', expect.objectContaining({
      organizationId: 1,
      refundRequest: expect.objectContaining({ id: 10 }),
    }));
  });
});

// =============================================================================
// reviewRequest
// =============================================================================
describe('reviewRequest', () => {
  test('approves a requested refund request', async () => {
    const approved = { ...MOCK_REQUEST, status: 'approved', reviewed_by: 3 };

    db.query
      .mockResolvedValueOnce([[MOCK_REQUEST]])   // findById
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update
      .mockResolvedValueOnce([[approved]]);       // SELECT after update

    const result = await refundRequestService.reviewRequest(1, 10, { status: 'approved', review_notes: 'OK' }, 3);
    expect(result).toMatchObject({ status: 'approved' });
  });

  test('rejects when status is already processed', async () => {
    db.query.mockResolvedValueOnce([[{ ...MOCK_REQUEST, status: 'processed' }]]);

    await expect(
      refundRequestService.reviewRequest(1, 10, { status: 'approved' }, 3),
    ).rejects.toThrow(/Cannot review/);
  });

  test('rejects an invalid review status', async () => {
    db.query.mockResolvedValueOnce([[MOCK_REQUEST]]);

    await expect(
      refundRequestService.reviewRequest(1, 10, { status: 'processed' }, 3),
    ).rejects.toThrow(/approved.*rejected/);
  });
});

// =============================================================================
// processRequest
// =============================================================================
describe('processRequest', () => {
  const approved = { ...MOCK_REQUEST, status: 'approved' };

  test('processes via credit_balance and emits refund.processed', async () => {
    const processed = { ...approved, status: 'processed', refund_method: 'credit_balance' };

    db.query
      .mockResolvedValueOnce([[approved]])       // findById
      .mockResolvedValueOnce([[{ id: 5 }]])      // fetch client
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // ledger insert
      .mockResolvedValueOnce([[{ amount: '150.00' }]]) // fetch payment_transaction
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update payment gateway_status
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update refund_requests status
      .mockResolvedValueOnce([[processed]]);      // SELECT after update

    const result = await refundRequestService.processRequest(1, 10, { refund_method: 'credit_balance' }, 3);
    expect(result).toMatchObject({ status: 'processed' });
    expect(billingAdjustmentService.record).toHaveBeenCalledOnce = expect.any(Function);
    expect(eventBus.emit).toHaveBeenCalledWith('refund.processed', expect.objectContaining({
      organizationId: 1,
    }));
  });

  test('rejects when status is not approved', async () => {
    db.query.mockResolvedValueOnce([[MOCK_REQUEST]]); // status: 'requested'

    await expect(
      refundRequestService.processRequest(1, 10, { refund_method: 'credit_balance' }, 3),
    ).rejects.toThrow(/Cannot process/);
  });
});
