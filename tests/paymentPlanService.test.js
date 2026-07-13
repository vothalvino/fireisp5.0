// =============================================================================
// FireISP 5.0 — Payment Plan Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
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
const paymentPlanService = require('../src/services/paymentPlanService');

describe('paymentPlanService', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      query: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
  });

  // ===========================================================================
  // createPlan
  // ===========================================================================
  describe('createPlan', () => {
    test('creates plan and installments for monthly frequency', async () => {
      const planId = 7;
      const inst1Id = 101;
      const inst2Id = 102;
      const inst3Id = 103;

      // INSERT payment_plans
      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: planId }])
        // INSERT installment 1
        .mockResolvedValueOnce([{ insertId: inst1Id }])
        // INSERT installment 2
        .mockResolvedValueOnce([{ insertId: inst2Id }])
        // INSERT installment 3
        .mockResolvedValueOnce([{ insertId: inst3Id }]);

      // SELECT plan after insert
      db.query.mockResolvedValueOnce([[{
        id: planId,
        organization_id: 1,
        client_id: 5,
        total_amount: '100.00',
        installment_count: 3,
        frequency: 'monthly',
        status: 'active',
      }]]);

      const result = await paymentPlanService.createPlan({
        organizationId: 1,
        clientId: 5,
        totalAmount: 100,
        installmentCount: 3,
        frequency: 'monthly',
        createdBy: 2,
      });

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.execute).toHaveBeenCalledTimes(4); // 1 plan + 3 installments
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();

      expect(result.plan.id).toBe(planId);
      expect(result.installments).toHaveLength(3);
      expect(result.installments[0].sequence).toBe(1);
      expect(result.installments[1].sequence).toBe(2);
      expect(result.installments[2].sequence).toBe(3);
    });

    test('splits amounts correctly for 3 installments of $100', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 10 }])   // plan
        .mockResolvedValueOnce([{ insertId: 11 }])   // inst 1
        .mockResolvedValueOnce([{ insertId: 12 }])   // inst 2
        .mockResolvedValueOnce([{ insertId: 13 }]);  // inst 3

      db.query.mockResolvedValueOnce([[{ id: 10, total_amount: '100.00' }]]);

      const result = await paymentPlanService.createPlan({
        organizationId: 1,
        clientId: 5,
        totalAmount: 100,
        installmentCount: 3,
        frequency: 'monthly',
        createdBy: 2,
      });

      // splitAmounts(100, 3): unit = floor(100/3*100)/100 = 33.33
      // amounts = [33.33, 33.33, 33.34]
      expect(result.installments[0].amount).toBe(33.33);
      expect(result.installments[1].amount).toBe(33.33);
      expect(result.installments[2].amount).toBe(33.34);
    });

    test('when invoiceId provided, overrides totalAmount with invoice.total', async () => {
      // First call: SELECT invoice
      db.query.mockResolvedValueOnce([[{ id: 50, total: '250.00', status: 'issued' }]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 20 }])  // plan
        .mockResolvedValueOnce([{ insertId: 21 }])  // inst 1
        .mockResolvedValueOnce([{ insertId: 22 }]); // inst 2

      // SELECT plan after insert
      db.query.mockResolvedValueOnce([[{ id: 20, total_amount: '250.00' }]]);

      const result = await paymentPlanService.createPlan({
        organizationId: 1,
        clientId: 5,
        invoiceId: 50,
        totalAmount: 999, // should be overridden
        installmentCount: 2,
        frequency: 'monthly',
        createdBy: 2,
      });

      // The plan INSERT should use the invoice total (250), not 999
      const planInsertCall = mockConnection.execute.mock.calls[0];
      expect(planInsertCall[1]).toContain(250);
      expect(result.installments).toHaveLength(2);
    });

    test('throws NOT_FOUND when invoiceId does not exist', async () => {
      db.query.mockResolvedValueOnce([[]]); // invoice not found

      await expect(
        paymentPlanService.createPlan({
          organizationId: 1,
          clientId: 5,
          invoiceId: 9999,
          installmentCount: 2,
          frequency: 'monthly',
          createdBy: 2,
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('rolls back and rethrows on DB error', async () => {
      mockConnection.execute.mockRejectedValueOnce(new Error('DB insert failed'));

      await expect(
        paymentPlanService.createPlan({
          organizationId: 1,
          clientId: 5,
          totalAmount: 100,
          installmentCount: 2,
          frequency: 'weekly',
          createdBy: 2,
        }),
      ).rejects.toThrow('DB insert failed');

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // payInstallment
  // ===========================================================================
  describe('payInstallment', () => {
    test('marks installment as paid and creates allocation when invoice_id exists', async () => {
      const plan = { id: 1, organization_id: 1 };
      const installment = { id: 10, plan_id: 1, sequence: 2, amount: '50.00', invoice_id: 99, status: 'pending' };
      const payment = { id: 5, organization_id: 1, amount: '50.00' };

      db.query
        .mockResolvedValueOnce([[plan]])       // SELECT plan
        .mockResolvedValueOnce([[installment]]) // SELECT installment
        .mockResolvedValueOnce([[payment]]);    // SELECT payment

      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT payment_allocations
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE installment paid
        .mockResolvedValueOnce([[{ remaining: 3 }]]);   // SELECT COUNT remaining

      // SELECT updated installment
      db.query.mockResolvedValueOnce([[{ ...installment, status: 'paid' }]]);

      const result = await paymentPlanService.payInstallment(1, 2, 5, 1);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      // Allocation INSERT
      expect(mockConnection.execute.mock.calls[0][0]).toContain('INSERT INTO payment_allocations');
      // UPDATE installment
      expect(mockConnection.execute.mock.calls[1][0]).toContain("SET status = 'paid'");
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(result.status).toBe('paid');
    });

    test('marks plan as completed when all installments are paid', async () => {
      const plan = { id: 1, organization_id: 1 };
      const installment = { id: 11, plan_id: 1, sequence: 1, amount: '100.00', invoice_id: null, status: 'pending' };
      const payment = { id: 6, organization_id: 1 };

      db.query
        .mockResolvedValueOnce([[plan]])
        .mockResolvedValueOnce([[installment]])
        .mockResolvedValueOnce([[payment]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE installment paid (no allocation, no invoice_id)
        .mockResolvedValueOnce([[{ remaining: 0 }]])    // SELECT COUNT remaining = 0
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE plan to completed

      db.query.mockResolvedValueOnce([[{ ...installment, status: 'paid' }]]);

      await paymentPlanService.payInstallment(1, 1, 6, 1);

      // The last execute should update the plan to 'completed'
      const planUpdateCall = mockConnection.execute.mock.calls[2];
      expect(planUpdateCall[0]).toContain("'completed'");
      expect(planUpdateCall[1]).toContain(1);
    });

    test('throws NOT_FOUND if plan does not exist for org', async () => {
      db.query.mockResolvedValueOnce([[]]); // no plan

      await expect(
        paymentPlanService.payInstallment(999, 1, 1, 1),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('throws NOT_FOUND if installment does not exist', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }]])  // plan found
        .mockResolvedValueOnce([[]]); // installment not found

      await expect(
        paymentPlanService.payInstallment(1, 999, 1, 1),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('throws ValidationError if installment is already paid', async () => {
      const plan = { id: 1, organization_id: 1 };
      const installment = { id: 10, plan_id: 1, sequence: 1, status: 'paid' };

      db.query
        .mockResolvedValueOnce([[plan]])
        .mockResolvedValueOnce([[installment]]);

      await expect(
        paymentPlanService.payInstallment(1, 1, 5, 1),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    test('does not create allocation when invoice_id is null', async () => {
      const plan = { id: 1, organization_id: 1 };
      const installment = { id: 12, plan_id: 1, sequence: 1, amount: '75.00', invoice_id: null, status: 'pending' };
      const payment = { id: 7, organization_id: 1 };

      db.query
        .mockResolvedValueOnce([[plan]])
        .mockResolvedValueOnce([[installment]])
        .mockResolvedValueOnce([[payment]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE installment
        .mockResolvedValueOnce([[{ remaining: 2 }]]); // COUNT

      db.query.mockResolvedValueOnce([[{ ...installment, status: 'paid' }]]);

      await paymentPlanService.payInstallment(1, 1, 7, 1);

      // Only 2 execute calls: UPDATE installment + SELECT count (no allocation INSERT)
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);
      expect(mockConnection.execute.mock.calls[0][0]).not.toContain('INSERT INTO payment_allocations');
    });
  });

  // ===========================================================================
  // checkInstallmentsDue
  // ===========================================================================
  describe('checkInstallmentsDue', () => {
    test('calls db.query to mark overdue installments', async () => {
      db.query
        .mockResolvedValueOnce([{ affectedRows: 2 }]) // UPDATE overdue
        .mockResolvedValueOnce([[]])                  // SELECT newly overdue (empty)
        ;

      await paymentPlanService.checkInstallmentsDue();

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'overdue'"),
      );
    });

    test('does not throw when no installments are overdue', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(paymentPlanService.checkInstallmentsDue()).resolves.toBeUndefined();
      // Should only call UPDATE once (no SELECT needed when affectedRows=0)
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('does not write to notification_events — the table does not exist', async () => {
      // This used to INSERT INTO notification_events inside a try/catch. There is
      // no such table in database/schema.sql, so the INSERT threw for every row
      // and the catch swallowed it: the "fallback" log was the only code path that
      // ever ran. The service now logs directly and issues no INSERT.
      const overdueInst = { id: 5, plan_id: 1, sequence: 1, amount: '50.00', due_date: '2025-01-01', client_id: 10, organization_id: 1 };

      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE overdue
        .mockResolvedValueOnce([[overdueInst]]);        // SELECT overdue rows

      await expect(paymentPlanService.checkInstallmentsDue()).resolves.toBeUndefined();

      expect(db.query).toHaveBeenCalledTimes(2);
      const sqlIssued = db.query.mock.calls.map(([sql]) => sql).join('\n');
      expect(sqlIssued).not.toContain('notification_events');
    });
  });

  // ===========================================================================
  // getPlanWithInstallments
  // ===========================================================================
  describe('getPlanWithInstallments', () => {
    test('returns plan with installments array', async () => {
      const plan = { id: 1, organization_id: 1, status: 'active', installment_count: 2 };
      const installments = [
        { id: 1, plan_id: 1, sequence: 1, amount: '50.00', status: 'paid' },
        { id: 2, plan_id: 1, sequence: 2, amount: '50.00', status: 'pending' },
      ];

      db.query
        .mockResolvedValueOnce([[plan]])
        .mockResolvedValueOnce([installments]);

      const result = await paymentPlanService.getPlanWithInstallments(1, 1);

      expect(result.plan).toEqual(plan);
      expect(result.installments).toHaveLength(2);
      expect(result.installments[0].sequence).toBe(1);
      expect(result.installments[1].sequence).toBe(2);
    });

    test('throws NOT_FOUND when plan not found for org', async () => {
      db.query.mockResolvedValueOnce([[]]); // no plan

      await expect(
        paymentPlanService.getPlanWithInstallments(999, 1),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('queries with correct plan_id and organization_id', async () => {
      db.query.mockResolvedValueOnce([[]]); // triggers throw

      await expect(
        paymentPlanService.getPlanWithInstallments(42, 7),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id'),
        [42, 7],
      );
    });
  });
});
