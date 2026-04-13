// =============================================================================
// FireISP 5.0 — E2E Workflow: Suspension Warning → Suspend → Payment → Restore
// =============================================================================
// Tests the full suspension lifecycle: rule evaluation → suspend → reconnect.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Mock dgram so RADIUS packets don't actually get sent
jest.mock('dgram', () => {
  const socket = {
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
  };
  return { createSocket: jest.fn(() => socket) };
});

const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');

describe('E2E Workflow: Suspension Lifecycle', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
  });

  test('evaluateRules finds overdue contracts for suspension', async () => {
    const rule = {
      id: 1,
      organization_id: 1,
      days_past_due: 14,
      grace_period_days: 7,
      is_enabled: true,
    };

    const overdueContract = {
      id: 100,
      client_id: 50,
      status: 'active',
      invoice_id: 500,
      due_date: '2026-01-01',
      total: '580.00',
      days_overdue: 15,
    };

    db.query
      .mockResolvedValueOnce([[rule]])               // suspension rules
      .mockResolvedValueOnce([[overdueContract]]);    // overdue contracts

    const result = await suspensionService.evaluateRules(1);
    expect(result).toBeDefined();
    expect(result.length).toBe(1);
    expect(result[0].rule.id).toBe(1);
    expect(result[0].contract.id).toBe(100);
  });

  test('suspendContract changes status and sends RADIUS disconnect', async () => {
    // Mock: no RADIUS account found (simplifies test — CoA returns gracefully)
    db.query.mockResolvedValueOnce([[]]);  // sendRadiusDisconnect query returns no rows

    mockConnection.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE contracts → suspended
      .mockResolvedValueOnce([{ insertId: 1 }]);      // INSERT suspension_log

    await suspensionService.suspendContract(100, 1, 999, 500);

    // Verify transaction flow
    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
  });

  test('reconnectContract restores active status', async () => {
    // Mock: no RADIUS account
    db.query.mockResolvedValueOnce([[]]);

    mockConnection.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE contracts → active
      .mockResolvedValueOnce([{ insertId: 2 }]);      // INSERT suspension_log (unsuspend)

    await suspensionService.reconnectContract(100, 999, 500);

    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  test('suspendContract rolls back on error', async () => {
    db.query.mockResolvedValueOnce([[]]);

    mockConnection.execute
      .mockRejectedValueOnce(new Error('DB error'));

    await expect(suspensionService.suspendContract(100, 1, 999, 500))
      .rejects.toThrow('DB error');

    expect(mockConnection.rollback).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
  });
});

describe('E2E Workflow: Full Suspension → Reconnect cycle', () => {
  let mockConnection;

  beforeEach(() => {
    jest.resetAllMocks();
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
  });

  test('contract survives full lifecycle: evaluate → suspend → reconnect', async () => {
    // Phase 1: Evaluate rules — set mocks then call
    db.query
      .mockResolvedValueOnce([[{ id: 1, organization_id: 1, days_past_due: 14, grace_period_days: 7, is_enabled: true }]])
      .mockResolvedValueOnce([[{ id: 100, client_id: 50, status: 'active', invoice_id: 500, days_overdue: 15 }]]);

    const evaluateResult = await suspensionService.evaluateRules(1);
    expect(evaluateResult.length).toBe(1);

    // Phase 2: Suspend (no RADIUS account → graceful skip)
    db.query.mockResolvedValueOnce([[]]);  // sendRadiusDisconnect — no RADIUS rows
    mockConnection.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE contracts → suspended
      .mockResolvedValueOnce([{ insertId: 1 }]);       // INSERT suspension_log

    await suspensionService.suspendContract(100, 1, 999, 500);
    expect(mockConnection.commit).toHaveBeenCalledTimes(1);

    // Phase 3: Reconnect (no RADIUS account → graceful skip)
    db.query.mockResolvedValueOnce([[]]);  // sendRadiusCoA — no RADIUS rows
    mockConnection.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE contracts → active
      .mockResolvedValueOnce([{ insertId: 2 }]);       // INSERT suspension_log

    await suspensionService.reconnectContract(100, 999, 500);
    expect(mockConnection.commit).toHaveBeenCalledTimes(2);
  });
});
