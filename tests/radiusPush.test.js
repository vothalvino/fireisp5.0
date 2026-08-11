// =============================================================================
// FireISP 5.0 — RADIUS direct-provisioning push route tests
// =============================================================================
// Covers POST /api/radius/:id/push:
//   • success 200 (returns push result from routerProvisioningService)
//   • missing nas_id -> 422 (NO_NAS)
//   • router unreachable -> 502 (ROUTER_UNREACHABLE)
// =============================================================================

// Mock the database module before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/routerProvisioningService');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const routerProvisioningService = require('../src/services/routerProvisioningService');
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

const mockRadius = {
  id: 7,
  contract_id: 30,
  client_id: 12,
  nas_id: 4,
  username: 'pppoe-user',
  password: 'secret-pass',
  profile: '50M-plan',
  status: 'active',
};

const mockNas = {
  id: 4,
  organization_id: 1,
  name: 'NAS-1',
  ip_address: '10.0.0.1',
  api_port: 8728,
  api_username: 'admin',
  api_use_tls: 0,
};

const activeContract = {
  status: 'active',
  connection_type: 'pppoe',
  test_window_cleanup_pending: 0,
  test_window_open: 0,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// POST /api/radius/:id/push
// =============================================================================
describe('POST /api/radius/:id/push', () => {

  test('pushes the subscriber to its NAS and returns 200 with the result', async () => {
    mockAuthUser();
    // 1) Radius  2) contract lifecycle  3) NAS
    db.query
      .mockResolvedValueOnce([[mockRadius]])
      .mockResolvedValueOnce([[activeContract]])
      .mockResolvedValueOnce([[mockNas]]);

    routerProvisioningService.pushSubscriber.mockResolvedValue({
      id: '*5',
      created: true,
      updated: false,
    });

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: '*5', created: true, updated: false });

    // verifies the route assembled the NAS + subscriber payload correctly
    expect(routerProvisioningService.pushSubscriber).toHaveBeenCalledTimes(1);
    const [nasArg, subArg] = routerProvisioningService.pushSubscriber.mock.calls[0];
    expect(nasArg).toMatchObject({ id: 4, ip_address: '10.0.0.1' });
    expect(subArg).toMatchObject({
      username: 'pppoe-user',
      password: 'secret-pass',
      profile: '50M-plan',
      comment: 'FireISP radius#7 client#12 contract#30',
    });
  });

  test('returns 422 NO_NAS when the subscriber has no NAS assigned', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ ...mockRadius, nas_id: null }]]);

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_NAS');
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
  });

  test('returns 502 ROUTER_UNREACHABLE when the router push fails', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[mockRadius]])
      .mockResolvedValueOnce([[activeContract]])
      .mockResolvedValueOnce([[mockNas]]);

    routerProvisioningService.pushSubscriber.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('ROUTER_UNREACHABLE');
    expect(res.body.error.message).toBe('connect ETIMEDOUT');
  });

  test('keeps an active standalone RADIUS account pushable without a contract', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ ...mockRadius, contract_id: null }]])
      .mockResolvedValueOnce([[mockNas]]);
    routerProvisioningService.pushSubscriber.mockResolvedValue({
      id: '*6', created: true, updated: false,
    });

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(routerProvisioningService.pushSubscriber).toHaveBeenCalledTimes(1);
  });

  test('uses bounded RADIUS only for a pending open test window and removes a local secret', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[mockRadius]])
      .mockResolvedValueOnce([[
        { ...activeContract, status: 'pending', test_window_open: 1 },
      ]])
      .mockResolvedValueOnce([[mockNas]]);
    routerProvisioningService.removeSubscriber.mockResolvedValue({
      deleted: false, alreadyAbsent: true, name: 'pppoe-user',
    });

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      mode: 'bounded_radius', local_secret_disabled: true, created: false,
    });
    expect(routerProvisioningService.removeSubscriber).toHaveBeenCalledWith(
      mockNas, { username: 'pppoe-user' },
    );
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
  });

  test('rejects a pending subscriber when its bounded test window is not open', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[mockRadius]])
      .mockResolvedValueOnce([[
        { ...activeContract, status: 'pending', test_window_open: 0 },
      ]])
      .mockResolvedValueOnce([[mockNas]]);

    const res = await request(app)
      .post('/api/radius/7/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEST_WINDOW_NOT_OPEN');
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
    expect(routerProvisioningService.removeSubscriber).not.toHaveBeenCalled();
  });

  test('returns 404 when the radius account does not exist', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]); // Radius.findByIdOrFail -> NotFound

    const res = await request(app)
      .post('/api/radius/999/push')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
  });

  test('returns 401 without an auth header', async () => {
    const res = await request(app).post('/api/radius/7/push');
    expect(res.status).toBe(401);
  });
});
