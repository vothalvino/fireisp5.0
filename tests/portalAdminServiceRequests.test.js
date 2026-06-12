// =============================================================================
// FireISP 5.0 — Portal Admin Service Requests Tests
// =============================================================================
// Tests for:
//   - portalServiceRequestService admin functions (adminListRequests,
//     adminGetRequest, approveRequest, rejectRequest, completeRequest)
//   - push subscription notify_* preference storage
//   - portalPushService dispatch (VAPID not configured → no-op)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

const db = require('../src/config/database');
const portalServiceRequestService = require('../src/services/portalServiceRequestService');
const portalPushService = require('../src/services/portalPushService');

// ---------------------------------------------------------------------------
// adminListRequests
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.adminListRequests()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns paginated rows for org', async () => {
    const row = {
      id: 1, client_id: 5, request_type: 'plan_upgrade', status: 'pending',
      client_name: 'Alice Smith', client_email: 'alice@example.com',
    };
    db.query
      .mockResolvedValueOnce([[row]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const { rows, total } = await portalServiceRequestService.adminListRequests(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].client_name).toBe('Alice Smith');
    expect(total).toBe(1);
  });

  test('applies status filter', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    await portalServiceRequestService.adminListRequests(1, { status: 'approved' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/status/);
    expect(params).toContain('approved');
  });

  test('applies request_type filter', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    await portalServiceRequestService.adminListRequests(1, { requestType: 'pppoe_password_change' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/request_type/);
    expect(params).toContain('pppoe_password_change');
  });

  test('applies client_id filter', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    await portalServiceRequestService.adminListRequests(1, { clientId: 42 });
    const [sql, params] = db.query.mock.calls[0];
    expect(params).toContain(42);
  });
});

// ---------------------------------------------------------------------------
// adminGetRequest
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.adminGetRequest()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns request row when found', async () => {
    const row = { id: 3, request_type: 'cancellation', status: 'pending', organization_id: 1 };
    db.query.mockResolvedValueOnce([[row]]);

    const result = await portalServiceRequestService.adminGetRequest(3, 1);
    expect(result.id).toBe(3);
  });

  test('throws NotFoundError when request not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty result
    await expect(portalServiceRequestService.adminGetRequest(999, 1))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// rejectRequest
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.rejectRequest()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws NotFoundError when request not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT
    await expect(portalServiceRequestService.rejectRequest(99, 1, 'not needed'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws ValidationError when status is not pending', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'approved' }]]);
    await expect(portalServiceRequestService.rejectRequest(1, 1, 'sorry'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('sets status to rejected with notes', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]);           // UPDATE

    const result = await portalServiceRequestService.rejectRequest(1, 1, 'Cannot process');
    expect(result.status).toBe('rejected');
    const [updateSql, updateParams] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/status = 'rejected'/);
    expect(updateParams).toContain('Cannot process');
  });
});

// ---------------------------------------------------------------------------
// completeRequest
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.completeRequest()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws NotFoundError when not found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(portalServiceRequestService.completeRequest(99, 1))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws ValidationError when status is not approved', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);
    await expect(portalServiceRequestService.completeRequest(1, 1))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('marks approved request as completed', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, status: 'approved' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await portalServiceRequestService.completeRequest(1, 1);
    expect(result.status).toBe('completed');
    const [updateSql] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/status = 'completed'/);
  });
});

// ---------------------------------------------------------------------------
// approveRequest — pppoe_password_change path
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.approveRequest() — pppoe_password_change', () => {
  beforeEach(() => jest.clearAllMocks());

  test('approves + applies PPPoE password and marks completed', async () => {
    const req = {
      id: 10, organization_id: 1, status: 'pending',
      request_type: 'pppoe_password_change', contract_id: 5,
      payload: JSON.stringify({ new_password: 'newSecret123' }),
    };

    db.query
      .mockResolvedValueOnce([[req]])          // SELECT for approveRequest
      .mockResolvedValueOnce([{}])             // UPDATE (set approved)
      // applyPppoePasswordChange internals:
      .mockResolvedValueOnce([[req]])          // SELECT for applyPppoePasswordChange
      .mockResolvedValueOnce([{}])             // UPDATE radius password
      .mockResolvedValueOnce([{}])             // UPDATE status=completed in applyPppoePasswordChange
      .mockResolvedValueOnce([[{ ...req, status: 'completed', approved_by: 7 }]]); // final SELECT

    const result = await portalServiceRequestService.approveRequest(10, 1, 7, null);
    expect(result.status).toBe('completed');
    expect(result.approved_by).toBe(7);

    // Verify the RADIUS update SQL was called
    const radiusSql = db.query.mock.calls[3][0];
    expect(radiusSql).toMatch(/UPDATE radius/);
  });
});

// ---------------------------------------------------------------------------
// approveRequest — plan_upgrade path
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.approveRequest() — plan_upgrade', () => {
  beforeEach(() => jest.clearAllMocks());

  test('approves plan upgrade, updates contract.plan_id, marks completed', async () => {
    const req = {
      id: 20, organization_id: 1, status: 'pending',
      request_type: 'plan_upgrade', contract_id: 8,
      payload: JSON.stringify({ new_plan_id: 3, new_plan_name: 'Fiber Pro' }),
    };

    db.query
      .mockResolvedValueOnce([[req]])  // SELECT
      .mockResolvedValueOnce([{}])     // UPDATE (set approved)
      .mockResolvedValueOnce([{}])     // UPDATE contracts SET plan_id
      .mockResolvedValueOnce([{}])     // UPDATE status=completed
      .mockResolvedValueOnce([[{ ...req, status: 'completed', approved_by: 2 }]]); // final SELECT

    const result = await portalServiceRequestService.approveRequest(20, 1, 2, 'Upgrade approved');
    expect(result.status).toBe('completed');

    // Verify contract plan_id was updated
    const contractSql = db.query.mock.calls[2][0];
    expect(contractSql).toMatch(/UPDATE contracts SET plan_id/);
    expect(db.query.mock.calls[2][1]).toContain(3); // new_plan_id
  });
});

// ---------------------------------------------------------------------------
// approveRequest — ValidationError on non-pending
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.approveRequest() — guard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws ValidationError when request not pending', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'approved', organization_id: 1 }]]);
    await expect(portalServiceRequestService.approveRequest(1, 1, 5, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('throws NotFoundError when request not found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(portalServiceRequestService.approveRequest(99, 1, 5, null))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// upsertPushSubscription — notify_* preference storage
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.upsertPushSubscription() — notify_* prefs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inserts with default notify_* (all 1) when not provided', async () => {
    db.query
      .mockResolvedValueOnce([[]])             // SELECT existing
      .mockResolvedValueOnce([{ insertId: 9 }]); // INSERT

    const result = await portalServiceRequestService.upsertPushSubscription({
      clientId: 1, organizationId: 1,
      endpoint: 'https://push.example.com/a', p256dh: 'k', auth: 's',
    });
    expect(result.updated).toBe(false);
    const [insertSql, insertParams] = db.query.mock.calls[1];
    expect(insertSql).toMatch(/notify_outage/);
    // Default values: 1 for all three
    expect(insertParams.slice(-3)).toEqual([1, 1, 1]);
  });

  test('inserts with explicit notify_billing=false', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 10 }]);

    await portalServiceRequestService.upsertPushSubscription({
      clientId: 1, organizationId: 1,
      endpoint: 'https://push.example.com/b', p256dh: 'k', auth: 's',
      notifyBilling: false,
    });
    const [, insertParams] = db.query.mock.calls[1];
    // notify_outage=1, notify_billing=0, notify_ticket=1
    expect(insertParams.slice(-3)).toEqual([1, 0, 1]);
  });

  test('updates notify_* columns when subscription already exists', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5 }]])  // SELECT existing
      .mockResolvedValueOnce([{}]);           // UPDATE

    await portalServiceRequestService.upsertPushSubscription({
      clientId: 1, organizationId: 1,
      endpoint: 'https://push.example.com/c', p256dh: 'k2', auth: 's2',
      notifyOutage: false, notifyBilling: true, notifyTicket: false,
    });
    const [updateSql, updateParams] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/notify_outage/);
    expect(updateParams).toContain(0); // notifyOutage=false → 0
    expect(updateParams).toContain(1); // notifyBilling=true → 1
  });

  test('does NOT add notify_* to UPDATE when prefs not provided', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 6 }]])
      .mockResolvedValueOnce([{}]);

    await portalServiceRequestService.upsertPushSubscription({
      clientId: 1, organizationId: 1,
      endpoint: 'https://push.example.com/d', p256dh: 'k3', auth: 's3',
    });
    const [updateSql] = db.query.mock.calls[1];
    // When notify prefs are undefined, they should NOT appear in SET clause
    expect(updateSql).not.toMatch(/notify_outage/);
  });
});

// ---------------------------------------------------------------------------
// portalPushService — no-op when VAPID not configured
// ---------------------------------------------------------------------------

describe('portalPushService.dispatch() — VAPID not configured', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure VAPID env vars are unset
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  test('returns { sent: 0, failed: 0 } when VAPID not configured', async () => {
    const result = await portalPushService.dispatch({
      clientId: 1,
      eventType: 'billing',
      payload: { title: 'Test', body: 'Hello' },
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    // DB query should NOT be called since we exit early
    expect(db.query).not.toHaveBeenCalled();
  });

  test('returns { sent: 0, failed: 0 } for unknown eventType', async () => {
    process.env.VAPID_PUBLIC_KEY = 'fake';
    process.env.VAPID_PRIVATE_KEY = 'fake';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';

    const result = await portalPushService.dispatch({
      clientId: 1,
      eventType: 'unknown_type',
      payload: { title: 'Test', body: 'Hello' },
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});
