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

  // -------------------------------------------------------------------------
  // j63: Acct-Session-Id is only unique PER NAS. A bare id that collides
  // across routers used to be resolved by LIMIT 1 with no ORDER BY — i.e.
  // whichever row MySQL returned first — so kicking session 81f3a2c1 could
  // disconnect a DIFFERENT subscriber holding the same id on another NAS.
  // -------------------------------------------------------------------------
  test('sessions entries pin the session to its NAS in the lookup', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: '10.0.0.2', session_id: 'sess-1' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ sessions: [{ acct_session_id: 'sess-1', nas_ip_address: '10.0.0.2' }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ session_id: 'sess-1', success: true }]);
    // The NAS IP participates in the RESOLUTION query, not just the send
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/cl\.nas_ip_address = \?/);
    expect(params).toContain('10.0.0.2');
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(30, {
      acctSessionId: 'sess-1',
      nasIpAddress: '10.0.0.2',
    });
  });

  test('a bare session id colliding across NASes is rejected as ambiguous, nothing is sent', async () => {
    mockAuthUser();
    // Two different subscribers hold the same Acct-Session-Id on two routers.
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: '10.0.0.2', session_id: '81f3a2c1' },
      { contract_id: 77, nas_ip_address: '10.0.0.3', session_id: '81f3a2c1' },
    ]]);

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['81f3a2c1'] });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ session_id: '81f3a2c1', success: false });
    expect(res.body.data[0].error).toMatch(/[Aa]mbiguous/);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('same session recorded with and without a NAS IP is ONE session, not a collision', async () => {
    mockAuthUser();
    // Mixed accounting writers: one row NULL nas_ip, one set — same contract.
    db.query.mockResolvedValueOnce([[
      { contract_id: 30, nas_ip_address: null, session_id: 'sess-9' },
      { contract_id: 30, nas_ip_address: '10.0.0.2', session_id: 'sess-9' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['sess-9'] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ session_id: 'sess-9', success: true }]);
    // The non-null NAS IP wins so the send is still targeted
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(30, {
      acctSessionId: 'sess-9',
      nasIpAddress: '10.0.0.2',
    });
  });

  test('a malformed sessions entry is a 400, not a silent skip', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ sessions: [{ nas_ip_address: '10.0.0.2' }] });
    expect(res.status).toBe(400);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Tenancy — the disconnect target must belong to the caller's organisation
// =============================================================================
// Both lookups here resolved a target with NO organisation filter: the
// session_id branch read connection_logs (which has no organization_id of its
// own) and the username branch read `radius` directly. req.orgId reached only
// the audit row, so a cross-tenant disconnect was recorded under the CALLER's
// org.
//
// The username branch was the sharper edge: `uq_radius_username (username,
// active_flag)` makes a username unique across the WHOLE INSTALL, so another
// tenant's username resolved unambiguously to that tenant's contract — and
// PPPoE usernames are routinely derived from a client number.
//
// radius.batch_disconnect is granted to `admin` AND `technician` (migration
// 236), so this was reachable by any technician in any org.
//
// It became reachable in practice only with the roaming-aware change: before
// it, every primary Disconnect packet went to dgram's default (localhost), so
// the missing scope was inert. Fixing the targeting made the pre-existing hole
// live — which is why "the diff didn't introduce it" was not a reason to leave
// it alone.
describe('disconnect-batch is organisation-scoped', () => {
  test('a session belonging to another org is not found, and no packet is sent', async () => {
    mockAuthUser();
    // The scoped query matches nothing because the contract is org 2.
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['other-tenant-session'] });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ success: false });
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('the session lookup filters on the contract organisation', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]);

    await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['s1'] });

    const [sql, params] = db.query.mock.calls[0];
    // connection_logs has no organization_id — the contract is the only anchor.
    expect(sql).toMatch(/JOIN\s+contracts\s+c\s+ON\s+c\.id\s*=\s*cl\.contract_id/i);
    expect(sql).toMatch(/c\.organization_id/);
    expect(params).toContain(1); // req.orgId
  });

  test("another org's username is not found, and no packet is sent", async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ usernames: ['pppoe-of-another-tenant'] });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ username: 'pppoe-of-another-tenant', success: false });
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('the username lookup filters on the contract organisation', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]);

    await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ usernames: ['someone'] });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM\s+radius\s+r/i);
    expect(sql).toMatch(/JOIN\s+contracts\s+c\s+ON\s+c\.id\s*=\s*r\.contract_id/i);
    expect(sql).toMatch(/c\.organization_id/);
    expect(params).toContain(1);
  });

  test('an in-org session still disconnects — the scope must not break the feature', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[
      { contract_id: 42, nas_ip_address: '10.0.0.7', session_id: 'sess-1' },
    ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'ACK' });

    const res = await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: ['sess-1'] });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ session_id: 'sess-1', success: true });
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(42, {
      acctSessionId: 'sess-1',
      nasIpAddress: '10.0.0.7',
    });
  });
});

// =============================================================================
// The single-account disconnect route needs the same anchor
// =============================================================================
// POST /radius/:id/disconnect resolved its target with
// `SELECT contract_id FROM radius WHERE id = ?` — no organisation filter, no
// deleted_at, and req.orgId never referenced. radius ids are sequential and
// enumerable, and `devices.update` is granted to admin AND technician
// (migration 119), so a technician at one reseller could drop another
// reseller's subscriber with a single POST. Verified reachable by execution
// during review: HTTP 200 and a real disconnectSession call on a foreign row.
describe('POST /radius/:id/disconnect is organisation-scoped', () => {
  test("another org's account is not found, and no packet is sent", async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]); // scoped lookup matches nothing

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('the lookup filters on the contract organisation and excludes soft-deleted rows', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]);

    await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/JOIN\s+contracts\s+c\s+ON\s+c\.id\s*=\s*r\.contract_id/i);
    expect(sql).toMatch(/c\.organization_id/);
    expect(sql).toMatch(/r\.deleted_at IS NULL/);
    expect(params).toContain(1); // req.orgId
  });

  test('an in-org account still disconnects — the scope must not break the feature', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ contract_id: 42 }]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'ACK' });

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(42);
  });
});

// =============================================================================
// j63 — the per-session Disconnect button used to kill EVERY session
// =============================================================================
// The RadiusSessions row button posts to /:id/disconnect, which called
// disconnectSession(contractId) with no opts — a contract-wide Disconnect on
// every NAS. A subscriber with two legitimate sessions lost both when the
// operator kicked one row. The route now accepts { acct_session_id,
// nas_ip_address }, resolves the DB-canonical open session anchored on the
// account's contract, and narrows the kill to that one session.
describe('POST /radius/:id/disconnect per-session targeting', () => {
  test('body {acct_session_id, nas_ip_address} narrows the kill to that session', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ contract_id: 42 }]])  // org-scoped account lookup
      .mockResolvedValueOnce([[{ session_id: 'sess-1', nas_ip_address: '10.0.0.2' }]]); // session resolution

    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      // padded request value — the DB-canonical session_id must be sent, not this
      .send({ acct_session_id: 'sess-1   ', nas_ip_address: '10.0.0.2' });

    expect(res.status).toBe(200);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(42, {
      acctSessionId: 'sess-1',
      nasIpAddress: '10.0.0.2',
    });
    // The session lookup is anchored on THIS account's contract — the pair
    // from the request is a lookup key, never trusted directly.
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toMatch(/cl\.contract_id = \?/);
    expect(params[0]).toBe(42);
    expect(sql).toMatch(/IN \('start', 'interim-update'\)/);
  });

  test('a targeted session that no longer exists is a 404, NOT a contract-wide kill', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ contract_id: 42 }]])
      .mockResolvedValueOnce([[]]); // session gone / already stopped

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_id: 'stale-sess', nas_ip_address: '10.0.0.2' });

    expect(res.status).toBe(404);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('a lone nas_ip_address is a 400 — it must not silently widen to a contract-wide kill', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ contract_id: 42 }]]);

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ nas_ip_address: '10.0.0.2' });

    expect(res.status).toBe(400);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('an unpinned session id active on two NASes of the same contract is a 409, not a guess', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ contract_id: 42 }]])
      .mockResolvedValueOnce([[
        { session_id: 'dup', nas_ip_address: '10.0.0.2' },
        { session_id: 'dup', nas_ip_address: '10.0.0.3' },
      ]]);

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_id: 'dup' });

    expect(res.status).toBe(409);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('a session recorded with and without a NAS IP coalesces to the non-null NAS', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ contract_id: 42 }]])
      .mockResolvedValueOnce([[
        { session_id: 'sess-1', nas_ip_address: null },
        { session_id: 'sess-1', nas_ip_address: '10.0.0.2' },
      ]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_id: 'sess-1' });

    expect(res.status).toBe(200);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(42, {
      acctSessionId: 'sess-1',
      nasIpAddress: '10.0.0.2',
    });
  });

  test('non-string acct_session_ids elements are a 400 (numeric coercion would full-scan and over-match)', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/v1/radius/sessions/disconnect-batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ acct_session_ids: [0] });
    expect(res.status).toBe(400);
    expect(radiusService.disconnectSession).not.toHaveBeenCalled();
  });

  test('an empty body keeps the historical contract-wide disconnect', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ contract_id: 42 }]]);
    radiusService.disconnectSession.mockResolvedValue({ sent: true, response: 'ACK' });

    const res = await request(app)
      .post('/api/v1/radius/4711/disconnect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(200);
    // One query only — no session resolution — and no per-session opts.
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(radiusService.disconnectSession).toHaveBeenCalledWith(42);
  });
});
