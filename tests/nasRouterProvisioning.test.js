// =============================================================================
// FireISP 5.0 — NAS RouterOS Direct-Provisioning Route Tests
// =============================================================================
// Covers src/routes/nas.js item (4): POST /nas/:id/test-connection wiring and
// the guarantee that api_password_encrypted is never returned by POST/PUT /nas.
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
// Helpers (mirror tests/coreRoutes.test.js)
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

const mockNas = {
  id: 7,
  organization_id: 1,
  name: 'Core-RB',
  ip_address: '10.10.0.1',
  secret: 'radsecret',
  type: 'mikrotik',
  status: 'active',
  api_port: 8728,
  api_username: 'fireisp',
  api_password_encrypted: 'iv:tag:cipher',
  api_use_tls: false,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// POST /api/nas/:id/test-connection
// =============================================================================
describe('POST /api/nas/:id/test-connection', () => {
  test('returns 200 with connection data on success', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[mockNas]]); // Nas.findByIdOrFail
    routerProvisioningService.testConnection.mockResolvedValue({
      ok: true,
      host: '10.10.0.1',
      port: 8728,
      tls: false,
      version: '7.14.2',
      boardName: 'RB5009',
      identity: 'Core-RB',
    });

    const res = await request(app)
      .post('/api/nas/7/test-connection')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.version).toBe('7.14.2');
    expect(res.body.data.boardName).toBe('RB5009');
    // The NAS row (incl. encrypted password) was loaded and passed to the service
    expect(routerProvisioningService.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, api_username: 'fireisp' }),
    );
  });

  test('returns 502 ROUTER_UNREACHABLE when the router errors', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[mockNas]]); // Nas.findByIdOrFail
    routerProvisioningService.testConnection.mockRejectedValue(
      new Error('connect ETIMEDOUT 10.10.0.1:8728'),
    );

    const res = await request(app)
      .post('/api/nas/7/test-connection')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('ROUTER_UNREACHABLE');
    expect(res.body.error.message).toMatch(/ETIMEDOUT/);
  });

  test('returns 404 when the NAS does not exist', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]); // Nas.findByIdOrFail -> NotFound

    const res = await request(app)
      .post('/api/nas/999/test-connection')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
    expect(routerProvisioningService.testConnection).not.toHaveBeenCalled();
  });

  test('returns 401 without auth header', async () => {
    const res = await request(app).post('/api/nas/7/test-connection');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST/PUT /api/nas — api_password_encrypted must never be returned
// =============================================================================
describe('NAS create/update responses redact api_password_encrypted', () => {
  test('POST /api/nas does not include api_password_encrypted', async () => {
    mockAuthUser();
    // Nas.createOrRestore: soft-deleted lookup -> (none) -> INSERT ->
    // findByIdIncludingDeleted, then auditLog.log
    db.query
      .mockResolvedValueOnce([[]])                                // createOrRestore: no soft-deleted row for this IP
      .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }]) // INSERT
      .mockResolvedValueOnce([[mockNas]])                         // findByIdIncludingDeleted
      .mockResolvedValueOnce([{ affectedRows: 1 }]);             // auditLog

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Core-RB',
        ip_address: '10.10.0.1',
        secret: 'radsecret',
        api_port: 8728,
        api_username: 'fireisp',
        api_password: 'super-secret',
        api_use_tls: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(7);
    expect(res.body.data).not.toHaveProperty('api_password_encrypted');
    expect(res.body.data).not.toHaveProperty('api_password');
    expect(res.body.data.api_username).toBe('fireisp');
  });

  test('POST /api/nas restores a soft-deleted row for the same IP (createOrRestore)', async () => {
    mockAuthUser();
    // createOrRestore finds a soft-deleted row -> UPDATE (restore) -> findById -> auditLog.
    // No INSERT: the archived row id (9) is reused, preserving history.
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])                            // soft-deleted row found for this IP
      .mockResolvedValueOnce([{ affectedRows: 1 }])                    // UPDATE (apply values + clear deleted_at)
      .mockResolvedValueOnce([[{ ...mockNas, id: 9 }]])               // findById (now live)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);                   // auditLog

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Core-RB', ip_address: '10.10.0.1', secret: 'radsecret', type: 'mikrotik' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(9); // restored archived row, not a fresh insert
    expect(res.body.data).not.toHaveProperty('api_password_encrypted');
    // The restore path must NOT run an INSERT — verify the second query was the UPDATE.
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE `nas` SET/);
    expect(db.query.mock.calls[1][0]).toMatch(/deleted_at = NULL/);
  });

  test('PUT /api/nas/:id does not include api_password_encrypted', async () => {
    mockAuthUser();
    // crudController.update: findByIdOrFail -> Nas.update (UPDATE -> findById) -> auditLog
    db.query
      .mockResolvedValueOnce([[mockNas]])                              // findByIdOrFail
      .mockResolvedValueOnce([{ affectedRows: 1 }])                    // UPDATE
      .mockResolvedValueOnce([[{ ...mockNas, api_username: 'newuser' }]]) // findById after update
      .mockResolvedValueOnce([{ affectedRows: 1 }]);                   // auditLog

    const res = await request(app)
      .put('/api/nas/7')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ api_username: 'newuser', api_password: 'rotated-secret' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('api_password_encrypted');
    expect(res.body.data).not.toHaveProperty('api_password');
    expect(res.body.data.api_username).toBe('newuser');
  });
});
