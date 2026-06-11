// =============================================================================
// FireISP 5.0 — Cash Reconciliation Service Unit Tests
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
const cashReconciliationService = require('../src/services/cashReconciliationService');

describe('cashReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // openSession
  // ===========================================================================
  describe('openSession', () => {
    test('throws ValidationError when agent already has an open session', async () => {
      db.query.mockResolvedValueOnce([[{ id: 5 }]]); // existing open session

      await expect(
        cashReconciliationService.openSession({ organizationId: 1, agentUserId: 10, notes: null }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

      // Should not proceed to INSERT
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('creates new session when no open session exists', async () => {
      const newSession = {
        id: 1,
        organization_id: 1,
        agent_user_id: 10,
        status: 'open',
        notes: 'test note',
      };

      db.query
        .mockResolvedValueOnce([[]])           // no existing session
        .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT
        .mockResolvedValueOnce([[newSession]]); // SELECT after insert

      const result = await cashReconciliationService.openSession({
        organizationId: 1,
        agentUserId: 10,
        notes: 'test note',
      });

      expect(db.query).toHaveBeenCalledTimes(3);
      expect(result).toEqual(newSession);
    });

    test('queries for open session with correct org and agent', async () => {
      db.query.mockResolvedValueOnce([[]]); // no existing
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);
      db.query.mockResolvedValueOnce([[{ id: 2 }]]);

      await cashReconciliationService.openSession({ organizationId: 99, agentUserId: 55, notes: null });

      const checkCall = db.query.mock.calls[0];
      expect(checkCall[0]).toContain("status = 'open'");
      expect(checkCall[1]).toContain(99);
      expect(checkCall[1]).toContain(55);
    });
  });

  // ===========================================================================
  // closeSession
  // ===========================================================================
  describe('closeSession', () => {
    const openSession = {
      id: 1,
      organization_id: 1,
      agent_user_id: 10,
      opened_at: new Date(Date.now() - 3600000).toISOString(),
      status: 'open',
    };

    test('computes expected_total from cash payments in the window', async () => {
      db.query
        .mockResolvedValueOnce([[openSession]])             // SELECT session
        .mockResolvedValueOnce([[{ expected_total: '200.00' }]]) // SUM payments
        .mockResolvedValueOnce([{ affectedRows: 1 }])       // UPDATE
        .mockResolvedValueOnce([[{ ...openSession, status: 'closed', expected_total: '200.00', counted_total: '220.00', variance: '20.00' }]]); // SELECT updated

      const result = await cashReconciliationService.closeSession(1, 1, 220);

      // Verify the UPDATE was called with the right values
      const updateCall = db.query.mock.calls[2];
      expect(updateCall[0]).toContain("status = 'closed'");
      expect(updateCall[1]).toContain(200);  // expectedTotal
      expect(updateCall[1]).toContain(220);  // countedTotal
    });

    test('computes variance correctly as counted - expected', async () => {
      db.query
        .mockResolvedValueOnce([[openSession]])
        .mockResolvedValueOnce([[{ expected_total: '300.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...openSession, status: 'closed', variance: '50.00' }]]);

      await cashReconciliationService.closeSession(1, 1, 350);

      const updateCall = db.query.mock.calls[2];
      // variance = 350 - 300 = 50
      expect(updateCall[1]).toContain(50);
    });

    test('computes negative variance correctly', async () => {
      db.query
        .mockResolvedValueOnce([[openSession]])
        .mockResolvedValueOnce([[{ expected_total: '500.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...openSession, status: 'closed', variance: '-25.00' }]]);

      await cashReconciliationService.closeSession(1, 1, 475);

      const updateCall = db.query.mock.calls[2];
      // variance = 475 - 500 = -25
      expect(updateCall[1]).toContain(-25);
    });

    test('throws NOT_FOUND when session not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // no session

      await expect(
        cashReconciliationService.closeSession(999, 1, 100),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('throws ValidationError when session is not open', async () => {
      db.query.mockResolvedValueOnce([[{ ...openSession, status: 'closed' }]]);

      await expect(
        cashReconciliationService.closeSession(1, 1, 100),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    test('updates status to closed', async () => {
      db.query
        .mockResolvedValueOnce([[openSession]])
        .mockResolvedValueOnce([[{ expected_total: '100.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...openSession, status: 'closed' }]]);

      const result = await cashReconciliationService.closeSession(1, 1, 100);

      const updateCall = db.query.mock.calls[2];
      expect(updateCall[0]).toContain("'closed'");
    });
  });

  // ===========================================================================
  // approveSession
  // ===========================================================================
  describe('approveSession', () => {
    const closedSession = {
      id: 1,
      organization_id: 1,
      agent_user_id: 10,
      status: 'closed',
    };

    test('throws NOT_FOUND when session not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // no session

      await expect(
        cashReconciliationService.approveSession(999, 1, 5),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('throws ValidationError when session is not closed', async () => {
      db.query.mockResolvedValueOnce([[{ ...closedSession, status: 'open' }]]);

      await expect(
        cashReconciliationService.approveSession(1, 1, 5),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    test('updates status to approved', async () => {
      const approvedSession = { ...closedSession, status: 'approved', approved_by: 5 };

      db.query
        .mockResolvedValueOnce([[closedSession]])          // SELECT session
        .mockResolvedValueOnce([{ affectedRows: 1 }])     // UPDATE
        .mockResolvedValueOnce([[approvedSession]]);        // SELECT updated

      const result = await cashReconciliationService.approveSession(1, 1, 5);

      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toContain("'approved'");
      expect(updateCall[1]).toContain(5); // approverUserId
    });

    test('returns approved session with approver info', async () => {
      const approvedSession = { ...closedSession, status: 'approved', approved_by: 5 };

      db.query
        .mockResolvedValueOnce([[closedSession]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[approvedSession]]);

      const result = await cashReconciliationService.approveSession(1, 1, 5);
      expect(result.status).toBe('approved');
      expect(result.approved_by).toBe(5);
    });
  });

  // ===========================================================================
  // getSessionDetail
  // ===========================================================================
  describe('getSessionDetail', () => {
    test('returns session with cash_payments array', async () => {
      const session = {
        id: 1,
        organization_id: 1,
        agent_user_id: 10,
        opened_at: new Date(Date.now() - 7200000).toISOString(),
        closed_at: new Date(Date.now() - 3600000).toISOString(),
        status: 'closed',
      };
      const payments = [
        { id: 1, amount: '100.00', payment_method: 'cash' },
        { id: 2, amount: '150.00', payment_method: 'cash' },
      ];

      db.query
        .mockResolvedValueOnce([[session]])
        .mockResolvedValueOnce([payments]);

      const result = await cashReconciliationService.getSessionDetail(1, 1);

      expect(result.session).toEqual(session);
      expect(result.payments).toHaveLength(2);
    });

    test('throws NOT_FOUND when session does not exist', async () => {
      db.query.mockResolvedValueOnce([[]]); // no session

      await expect(
        cashReconciliationService.getSessionDetail(999, 1),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('queries payments with correct org and agent filters', async () => {
      const session = {
        id: 2,
        organization_id: 7,
        agent_user_id: 33,
        opened_at: '2025-01-01T08:00:00Z',
        closed_at: '2025-01-01T17:00:00Z',
        status: 'closed',
      };

      db.query
        .mockResolvedValueOnce([[session]])
        .mockResolvedValueOnce([[]]); // no payments

      const result = await cashReconciliationService.getSessionDetail(2, 7);

      const paymentsCall = db.query.mock.calls[1];
      expect(paymentsCall[0]).toContain("payment_method = 'cash'");
      expect(paymentsCall[1]).toContain(7);   // orgId
      expect(paymentsCall[1]).toContain(33);  // agent_user_id
    });

    test('uses current time as window end when session is still open', async () => {
      const session = {
        id: 3,
        organization_id: 1,
        agent_user_id: 10,
        opened_at: new Date(Date.now() - 3600000).toISOString(),
        closed_at: null, // still open
        status: 'open',
      };

      db.query
        .mockResolvedValueOnce([[session]])
        .mockResolvedValueOnce([[]]); // no payments

      await cashReconciliationService.getSessionDetail(3, 1);

      // Should still succeed (using current time as window end)
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });
});
