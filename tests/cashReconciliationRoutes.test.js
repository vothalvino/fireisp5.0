// =============================================================================
// FireISP 5.0 — Cash Reconciliation Route Integration Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

jest.mock('../src/services/cashReconciliationService', () => ({
  openSession: jest.fn(),
  closeSession: jest.fn(),
  approveSession: jest.fn(),
  getSessionDetail: jest.fn(),
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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const cashReconciliationService = require('../src/services/cashReconciliationService');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// POST /api/v1/cash-reconciliation/sessions
// =============================================================================
describe('POST /api/v1/cash-reconciliation/sessions', () => {
  test('returns 201 with created session', async () => {
    mockAuthUser();

    const newSession = {
      id: 1,
      organization_id: 1,
      agent_user_id: 1,
      status: 'open',
      notes: null,
    };

    cashReconciliationService.openSession.mockResolvedValueOnce(newSession);

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
    expect(res.body.data.status).toBe('open');
    expect(cashReconciliationService.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 1,
        agentUserId: 1,
      }),
    );
  });

  test('passes notes to service', async () => {
    mockAuthUser();

    cashReconciliationService.openSession.mockResolvedValueOnce({
      id: 2,
      status: 'open',
      notes: 'Morning shift',
    });

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ notes: 'Morning shift' });

    expect(res.status).toBe(201);
    expect(cashReconciliationService.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Morning shift' }),
    );
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions')
      .send({});

    expect(res.status).toBe(401);
  });

  test('returns 422 when agent already has an open session', async () => {
    mockAuthUser();

    const { ValidationError } = require('../src/utils/errors');
    cashReconciliationService.openSession.mockRejectedValueOnce(
      new ValidationError('Agent already has an open reconciliation session'),
    );

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// GET /api/v1/cash-reconciliation/sessions
// =============================================================================
describe('GET /api/v1/cash-reconciliation/sessions', () => {
  test('returns 200 with list of sessions', async () => {
    mockAuthUser();

    const mockSession = {
      id: 1,
      organization_id: 1,
      agent_user_id: 1,
      status: 'closed',
    };

    db.query
      .mockResolvedValueOnce([[mockSession]])      // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]);    // count

    const res = await request(app)
      .get('/api/v1/cash-reconciliation/sessions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/cash-reconciliation/sessions');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/cash-reconciliation/sessions/:id
// =============================================================================
describe('GET /api/v1/cash-reconciliation/sessions/:id', () => {
  test('returns 200 with session and payments', async () => {
    mockAuthUser();

    const sessionDetail = {
      session: {
        id: 3,
        organization_id: 1,
        agent_user_id: 1,
        status: 'closed',
        expected_total: '500.00',
        counted_total: '510.00',
        variance: '10.00',
      },
      payments: [
        { id: 1, amount: '200.00', payment_method: 'cash' },
        { id: 2, amount: '300.00', payment_method: 'cash' },
      ],
    };

    cashReconciliationService.getSessionDetail.mockResolvedValueOnce(sessionDetail);

    const res = await request(app)
      .get('/api/v1/cash-reconciliation/sessions/3')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.session.id).toBe(3);
    expect(res.body.data.payments).toHaveLength(2);
    expect(cashReconciliationService.getSessionDetail).toHaveBeenCalledWith(3, 1);
  });

  test('returns 404 when session not found', async () => {
    mockAuthUser();

    const { NotFoundError } = require('../src/utils/errors');
    cashReconciliationService.getSessionDetail.mockRejectedValueOnce(
      new NotFoundError('cash_reconciliation_sessions'),
    );

    const res = await request(app)
      .get('/api/v1/cash-reconciliation/sessions/999')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/cash-reconciliation/sessions/1');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/v1/cash-reconciliation/sessions/:id/close
// =============================================================================
describe('POST /api/v1/cash-reconciliation/sessions/:id/close', () => {
  test('returns 200 with closed session', async () => {
    mockAuthUser();

    const closedSession = {
      id: 1,
      organization_id: 1,
      status: 'closed',
      expected_total: '400.00',
      counted_total: '420.00',
      variance: '20.00',
    };

    cashReconciliationService.closeSession.mockResolvedValueOnce(closedSession);

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/close')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ counted_total: 420 });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect(cashReconciliationService.closeSession).toHaveBeenCalledWith(1, 1, 420);
  });

  test('returns 422 when session is not open', async () => {
    mockAuthUser();

    const { ValidationError } = require('../src/utils/errors');
    cashReconciliationService.closeSession.mockRejectedValueOnce(
      new ValidationError('Session is not open'),
    );

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/close')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ counted_total: 100 });

    expect(res.status).toBe(422);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/close')
      .send({ counted_total: 100 });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/v1/cash-reconciliation/sessions/:id/approve
// =============================================================================
describe('POST /api/v1/cash-reconciliation/sessions/:id/approve', () => {
  test('returns 200 with approved session', async () => {
    mockAuthUser();

    const approvedSession = {
      id: 1,
      organization_id: 1,
      status: 'approved',
      approved_by: 1,
    };

    cashReconciliationService.approveSession.mockResolvedValueOnce(approvedSession);

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/approve')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(cashReconciliationService.approveSession).toHaveBeenCalledWith(1, 1, 1);
  });

  test('returns 422 when session is not closed', async () => {
    mockAuthUser();

    const { ValidationError } = require('../src/utils/errors');
    cashReconciliationService.approveSession.mockRejectedValueOnce(
      new ValidationError('Session must be closed before it can be approved'),
    );

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/approve')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/1/approve')
      .send({});

    expect(res.status).toBe(401);
  });

  test('returns 404 when session not found', async () => {
    mockAuthUser();

    const { NotFoundError } = require('../src/utils/errors');
    cashReconciliationService.approveSession.mockRejectedValueOnce(
      new NotFoundError('cash_reconciliation_sessions'),
    );

    const res = await request(app)
      .post('/api/v1/cash-reconciliation/sessions/999/approve')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(404);
  });
});
