// =============================================================================
// FireISP 5.0 — Embedded RADIUS Server (radiusServerService) Tests
// =============================================================================
// A radtest-style, in-process round-trip exercise of the embedded RADIUS server.
// We build real RFC 2865/2866 packets with radiusCoaEncoder + radiusServerCodec,
// feed them straight into handleAuth/handleAcct (injecting a capturing `respond`
// instead of a UDP socket), and assert on the decoded responses + DB/accounting
// side-effects. The database and accounting service are mocked.
// =============================================================================

const crypto = require('crypto');

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/radiusAccountingService', () => ({ ingestAccounting: jest.fn() }));

const db = require('../src/config/database');
const accounting = require('../src/services/radiusAccountingService');
const config = require('../src/config');
const codec = require('../src/services/radiusServerCodec');
const coa = require('../src/services/radiusCoaEncoder');
const svc = require('../src/services/radiusServerService');

const SECRET = 'testing123';
const NAS_IP = '10.0.0.1';

// Canned DB rows for the three SELECTs handleAuth performs (by SQL fragment).
const NAS_ROW = { id: 3, organization_id: 1, secret: SECRET };
const SUBSCRIBER_ROW = {
  id: 6, client_id: 9, contract_id: 14, username: 'bob',
  password: 's3cret', ip_address: null, plan_id: 1,
};
const PLAN_ROW = {
  id: 1, download_speed_mbps: 50, upload_speed_mbps: 10, radius_vendor: 'mikrotik',
};

/**
 * Default DB mock: route each SELECT to its canned [rows, fields] result by
 * matching a fragment of the SQL. Individual tests override before calling.
 */
function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    if (/FROM nas/.test(sql)) return Promise.resolve([[NAS_ROW]]);
    if (/FROM radius/.test(sql)) return Promise.resolve([[SUBSCRIBER_ROW]]);
    if (/FROM plans/.test(sql)) return Promise.resolve([[PLAN_ROW]]);
    return Promise.resolve([[]]);
  });
}

/** Build a real Access-Request packet (PAP) for username/password. */
function buildPapRequest({ username = 'bob', password = 's3cret', id = 7, reqAuth, secret = SECRET } = {}) {
  reqAuth = reqAuth || crypto.randomBytes(16);
  const attrs = coa.encodeAttributes([
    coa.encodeUserName(username),
    { type: codec.ATTR.USER_PASSWORD, value: codec.encodePapPassword(password, secret, reqAuth) },
  ]);
  return { pkt: coa.buildRadiusPacket(codec.CODE.ACCESS_REQUEST, id, reqAuth, attrs), reqAuth };
}

/** Build a real Access-Request packet using CHAP-Password. */
function buildChapRequest({ username = 'bob', password = 's3cret', id = 8, reqAuth } = {}) {
  reqAuth = reqAuth || crypto.randomBytes(16);
  const chapId = 0x11;
  // CHAP response = MD5(chapId + password + challenge); challenge = Request Authenticator.
  const resp = crypto.createHash('md5')
    .update(Buffer.from([chapId]))
    .update(Buffer.from(password, 'utf8'))
    .update(reqAuth)
    .digest();
  const chapPw = Buffer.concat([Buffer.from([chapId]), resp]); // 17 bytes
  const attrs = coa.encodeAttributes([
    coa.encodeUserName(username),
    { type: codec.ATTR.CHAP_PASSWORD, value: chapPw },
  ]);
  return { pkt: coa.buildRadiusPacket(codec.CODE.ACCESS_REQUEST, id, reqAuth, attrs), reqAuth };
}

/** Recompute the expected Response-Authenticator for a captured reply. */
function expectedResponseAuthenticator(responseBuf, reqAuth, secret = SECRET) {
  const work = Buffer.from(responseBuf);
  reqAuth.copy(work, 4); // put the original request authenticator back into the auth field
  return crypto.createHash('md5').update(work).update(Buffer.from(secret, 'utf8')).digest();
}

describe('radiusServerService — embedded RADIUS server', () => {
  let savedSecret;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
    // Reset counters so each assertion on _counters is independent.
    for (const k of Object.keys(svc._counters)) svc._counters[k] = 0;
    savedSecret = config.radiusServer.secret;
  });

  afterEach(() => {
    config.radiusServer.secret = savedSecret;
  });

  // ---------------------------------------------------------------------------
  // Access-Request → Access-Accept (PAP) — the happy path round-trip
  // ---------------------------------------------------------------------------
  describe('handleAuth() — PAP Access-Accept', () => {
    test('correct PAP password yields a signed Access-Accept with plan policy', async () => {
      const { pkt, reqAuth } = buildPapRequest();
      let captured = null;
      await svc.handleAuth(pkt, { address: NAS_IP, port: 1812 }, (buf) => { captured = buf; });

      expect(captured).not.toBeNull();
      const resp = codec.decodePacket(captured);

      // Access-Accept, same identifier as the request.
      expect(resp.code).toBe(codec.CODE.ACCESS_ACCEPT);
      expect(resp.identifier).toBe(7);

      // Service-Type (Framed-User=2) and Framed-Protocol (PPP=1) present.
      expect(codec.getInt(resp.attributes, codec.ATTR.SERVICE_TYPE)).toBe(2);
      expect(codec.getInt(resp.attributes, codec.ATTR.FRAMED_PROTOCOL)).toBe(1);

      // A Vendor-Specific (26) Mikrotik-Rate-Limit attribute is present.
      const vsa = resp.attributes.find((a) => a.type === codec.ATTR.VENDOR_SPECIFIC);
      expect(vsa).toBeTruthy();
      expect(vsa.value.readUInt32BE(0)).toBe(14988); // Mikrotik PEN
      expect(vsa.value[4]).toBe(8);                  // vendor-type = Mikrotik-Rate-Limit
      const rateLimit = vsa.value.subarray(6).toString('utf8');
      expect(rateLimit.startsWith('50M/10M')).toBe(true);

      // The Response-Authenticator must equal MD5(response + secret) with the
      // original request authenticator placed back in the auth field.
      const expected = expectedResponseAuthenticator(captured, reqAuth);
      expect(resp.authenticator.equals(expected)).toBe(true);

      expect(svc._counters.accepts).toBe(1);
      expect(svc._counters.rejects).toBe(0);
    });

    test('an active speed window overlays the plan policy in the Access-Accept (§10.2)', async () => {
      // Sessions established DURING a window must come up at window speeds —
      // the CoA transition path only reaches sessions already online.
      db.query.mockImplementation((sql) => {
        if (/FROM plan_speed_windows/.test(sql)) {
          return Promise.resolve([[{ id: 2, plan_id: 1, download_speed_mbps: 25, upload_speed_mbps: 5, priority: 10 }]]);
        }
        if (/FROM nas/.test(sql)) return Promise.resolve([[NAS_ROW]]);
        if (/FROM radius/.test(sql)) return Promise.resolve([[SUBSCRIBER_ROW]]);
        if (/FROM plans/.test(sql)) return Promise.resolve([[PLAN_ROW]]);
        return Promise.resolve([[]]);
      });

      const { pkt } = buildPapRequest({ id: 9 });
      let captured = null;
      await svc.handleAuth(pkt, { address: NAS_IP, port: 1812 }, (buf) => { captured = buf; });

      expect(captured).not.toBeNull();
      const resp = codec.decodePacket(captured);
      expect(resp.code).toBe(codec.CODE.ACCESS_ACCEPT);

      const vsa = resp.attributes.find((a) => a.type === codec.ATTR.VENDOR_SPECIFIC);
      expect(vsa).toBeTruthy();
      const rateLimit = vsa.value.subarray(6).toString('utf8');
      // Window CIR 25M/5M with bursts re-derived from the window speeds —
      // NOT the plan's 50M/10M.
      expect(rateLimit).toBe('25M/5M 50M/10M 25M/5M 8');
    });
  });

  // ---------------------------------------------------------------------------
  // Access-Request → Access-Reject (wrong PAP password)
  // ---------------------------------------------------------------------------
  describe('handleAuth() — Access-Reject', () => {
    test('wrong PAP password yields Access-Reject', async () => {
      const { pkt } = buildPapRequest({ password: 'wrongpw' });
      let captured = null;
      await svc.handleAuth(pkt, { address: NAS_IP, port: 1812 }, (buf) => { captured = buf; });

      expect(captured).not.toBeNull();
      const resp = codec.decodePacket(captured);
      expect(resp.code).toBe(codec.CODE.ACCESS_REJECT);
      expect(svc._counters.rejects).toBe(1);
      expect(svc._counters.accepts).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Access-Request → Access-Accept (CHAP)
  // ---------------------------------------------------------------------------
  describe('handleAuth() — CHAP Access-Accept', () => {
    test('valid CHAP-Password (challenge = request authenticator) yields Access-Accept', async () => {
      const { pkt, reqAuth } = buildChapRequest();
      let captured = null;
      await svc.handleAuth(pkt, { address: NAS_IP, port: 1812 }, (buf) => { captured = buf; });

      expect(captured).not.toBeNull();
      const resp = codec.decodePacket(captured);
      expect(resp.code).toBe(codec.CODE.ACCESS_ACCEPT);

      const expected = expectedResponseAuthenticator(captured, reqAuth);
      expect(resp.authenticator.equals(expected)).toBe(true);
      expect(svc._counters.accepts).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Access-Request from an UNKNOWN NAS → silently dropped (RFC 2865)
  // ---------------------------------------------------------------------------
  describe('handleAuth() — unknown NAS', () => {
    test('no NAS row and no configured fallback secret: respond NOT called, authDropped++', async () => {
      // NAS lookup returns no row, and no global fallback secret is configured.
      db.query.mockImplementation((sql) => {
        if (/FROM nas/.test(sql)) return Promise.resolve([[]]);
        if (/FROM radius/.test(sql)) return Promise.resolve([[SUBSCRIBER_ROW]]);
        if (/FROM plans/.test(sql)) return Promise.resolve([[PLAN_ROW]]);
        return Promise.resolve([[]]);
      });
      config.radiusServer.secret = '';

      const { pkt } = buildPapRequest();
      const respond = jest.fn();
      await svc.handleAuth(pkt, { address: '198.51.100.9', port: 1812 }, respond);

      expect(respond).not.toHaveBeenCalled();
      expect(svc._counters.authDropped).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Accounting-Request → Accounting-Response + ingestAccounting side-effect
  // ---------------------------------------------------------------------------
  describe('handleAcct() — Accounting-Request', () => {
    test('valid Accounting-Start is ingested and acknowledged with Accounting-Response', async () => {
      const sessionId = 'sess-abc-001';
      const attrs = coa.encodeAttributes([
        codec.encodeIntAttr(codec.ATTR.ACCT_STATUS_TYPE, 1), // Start
        coa.encodeUserName('bob'),
        { type: codec.ATTR.ACCT_SESSION_ID, value: Buffer.from(sessionId, 'utf8') },
        codec.encodeIntAttr(codec.ATTR.ACCT_INPUT_OCTETS, 123456),
      ]);
      // Build with a zeroed authenticator, then write the real one in.
      const pkt = coa.buildRadiusPacket(codec.CODE.ACCOUNTING_REQUEST, 9, Buffer.alloc(16), attrs);
      const reqAuth = coa.computeRequestAuthenticator(pkt, SECRET);
      reqAuth.copy(pkt, 4);

      let captured = null;
      await svc.handleAcct(pkt, { address: NAS_IP, port: 1813 }, (buf) => { captured = buf; });

      // ingestAccounting received the decoded fields.
      expect(accounting.ingestAccounting).toHaveBeenCalledTimes(1);
      const arg = accounting.ingestAccounting.mock.calls[0][0];
      expect(arg.acctStatusType).toBe('Start');
      expect(arg.userName).toBe('bob');
      expect(arg.acctSessionId).toBe(sessionId);
      expect(arg.acctInputOctets).toBe(123456);
      expect(arg.organizationId).toBe(1);

      // Reply is an Accounting-Response.
      expect(captured).not.toBeNull();
      const resp = codec.decodePacket(captured);
      expect(resp.code).toBe(codec.CODE.ACCOUNTING_RESPONSE);
      expect(resp.identifier).toBe(9);
      expect(svc._counters.acctIngested).toBe(1);
    });

    test('Accounting-Request with a bad authenticator is dropped (no ingest, no reply)', async () => {
      const attrs = coa.encodeAttributes([
        codec.encodeIntAttr(codec.ATTR.ACCT_STATUS_TYPE, 1),
        coa.encodeUserName('bob'),
      ]);
      // Leave a bogus (random) authenticator that will not validate.
      const pkt = coa.buildRadiusPacket(codec.CODE.ACCOUNTING_REQUEST, 10, crypto.randomBytes(16), attrs);

      const respond = jest.fn();
      await svc.handleAcct(pkt, { address: NAS_IP, port: 1813 }, respond);

      expect(accounting.ingestAccounting).not.toHaveBeenCalled();
      expect(respond).not.toHaveBeenCalled();
      expect(svc._counters.acctDropped).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle & status
  // ---------------------------------------------------------------------------
  describe('getStatus() / start() / stop()', () => {
    test('getStatus() returns the expected shape', () => {
      const status = svc.getStatus();
      expect(status).toEqual(
        expect.objectContaining({
          enabled: expect.any(Boolean),
          running: expect.any(Boolean),
          authPort: expect.any(Number),
          acctPort: expect.any(Number),
          counters: expect.any(Object),
        }),
      );
      // counters is a snapshot copy of the internal counters.
      expect(status.counters).toMatchObject({
        authRequests: expect.any(Number),
        accepts: expect.any(Number),
        rejects: expect.any(Number),
        authDropped: expect.any(Number),
        acctRequests: expect.any(Number),
        acctIngested: expect.any(Number),
        acctDropped: expect.any(Number),
      });
    });

    test('start()/stop() are a no-op when config.radiusServer.enabled is false', () => {
      const savedEnabled = config.radiusServer.enabled;
      config.radiusServer.enabled = false;
      try {
        expect(() => svc.start()).not.toThrow();
        expect(svc.getStatus().running).toBe(false);
        expect(() => svc.stop()).not.toThrow();
        expect(svc.getStatus().running).toBe(false);
      } finally {
        config.radiusServer.enabled = savedEnabled;
      }
    });
  });
});
