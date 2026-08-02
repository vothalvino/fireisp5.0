// =============================================================================
// FireISP 5.0 — POST /api/radius/sessions/disconnect-batch route tests
// =============================================================================
// Pins the per-session targeting contract added by the roaming-aware CoA
// change: the route must pass the DB-canonical session_id and the session's
// own NAS IP to disconnectSession, treat interim-update rows as open, and
// report success from the actual send result (not merely "didn't throw").
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
jest.mock('../src/services/radiusService');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const radiusService = require('../src/services/radiusService');
const auditLog = require('../src/services/auditLog');
const app = require('../src/app');

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
  auditLog.log.mockResolvedValue(undefined);
});

describe('POST /api/radius/sessions/disconnect-batch', () => {
  test('disconnects by session id with per-session targeting (canonical id + session NAS)', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: '10.0.0.2', session_id: 'sess-1' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      // padded request value — PAD SPACE collation matches the stored 'sess-1'
      .send({ acct_session_ids: ['sess-1   '] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ session_id: 'sess-1   ', success: true }]);
    // The DB-canonical session_id is sent to the NAS, never the raw request string
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(30, {
      acctSessionId: 'sess-1',
      nasIpAddress: '10.0.0.2',
    });
    // Open-session lookup must treat interim-update rows as open (the
    // embedded accounting writer updates the session row in place)
    expect(db.query.mock.calls[0][0]).toMatch(/IN \('start', 'interim-update'\)/);
  });

  test('a session row without a recorded NAS IP still passes nasIpAddress:null through', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: null, session_id: 'sess-2' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['sess-2'] });

    expect(res.status).toBe(200);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(30, {
      acctSessionId: 'sess-2',
      nasIpAddress: null,
    });
  });

  test('unknown or already-stopped session id reports failure without disconnecting', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['nope'] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { session_id: 'nope', success: false, error: 'Session not found or already stopped' },
    ]);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('an unsent disconnect ({sent:false}) is reported as failure, not success', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: '10.0.0.2', session_id: 'sess-3' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({
      sent: false,
      response: 'No target NAS (no open-session NAS and no home NAS configured)',
    });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['sess-3'] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        session_id: 'sess-3',
        success: false,
        error: 'No target NAS (no open-session NAS and no home NAS configured)',
      },
    ]);
  });

  test('disconnects by username (contract-wide, no per-session opts)', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ contract_id: 44 }]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ usernames: ['roamer@isp.net'] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ username: 'roamer@isp.net', success: true }]);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(44);
  });

  test('rejects an empty batch', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
