// =============================================================================
// FireISP 5.0 — WhatsApp identity service + webhook route tests
// =============================================================================

const crypto = require('crypto');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/utils/logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => mock) };
  return mock;
});

const db = require('../src/config/database');
const config = require('../src/config');
const wa = require('../src/services/whatsappService');
const webhookSvc = require('../src/services/whatsappWebhookService');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('normalizeE164', () => {
  it('strips the whatsapp: prefix and drops the legacy MX mobile 1', () => {
    expect(wa.normalizeE164('whatsapp:+5215512345678')).toBe('+525512345678');
  });
  it('keeps an already-canonical MX number', () => {
    expect(wa.normalizeE164('+525512345678')).toBe('+525512345678');
  });
  it('assumes MX (+52) for a bare 10-digit national number', () => {
    expect(wa.normalizeE164('5512345678')).toBe('+525512345678');
  });
  it('leaves a US number intact', () => {
    expect(wa.normalizeE164('+1 (415) 523-8886')).toBe('+14155238886');
  });
  it('strips a 00 international access prefix', () => {
    expect(wa.normalizeE164('005215512345678')).toBe('+525512345678');
  });
  it('returns null for junk / empty', () => {
    expect(wa.normalizeE164('abc')).toBeNull();
    expect(wa.normalizeE164('   ')).toBeNull();
    expect(wa.normalizeE164(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('code hashing', () => {
  it('hashCode is deterministic and hexEqual is constant-time-safe', () => {
    const h1 = wa.hashCode('123456');
    const h2 = wa.hashCode('123456');
    expect(h1).toBe(h2);
    expect(wa.hexEqual(h1, h2)).toBe(true);
    expect(wa.hexEqual(h1, wa.hashCode('654321'))).toBe(false);
  });
  it('generateNumericCode returns a zero-padded code of the requested length', () => {
    const c = wa.generateNumericCode(8);
    expect(c).toMatch(/^\d{8}$/);
  });
});

// ---------------------------------------------------------------------------
describe('verifyPhoneCode', () => {
  it('returns no_pending when there is no matching row', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const r = await wa.verifyPhoneCode({ phone: '+525512345678', purpose: 'link_email', code: '123456' });
    expect(r).toEqual({ ok: false, reason: 'no_pending' });
  });

  it('locks after the attempt ceiling', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, client_id: 7, organization_id: 3, code_hash: wa.hashCode('123456'), attempts: config.whatsapp.maxCodeAttempts }]]);
    const r = await wa.verifyPhoneCode({ phone: '+525512345678', purpose: 'link_email', code: '123456' });
    expect(r).toEqual({ ok: false, reason: 'locked' });
  });

  it('increments attempts and reports mismatch on a wrong code', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, client_id: 7, organization_id: 3, code_hash: wa.hashCode('999999'), attempts: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await wa.verifyPhoneCode({ phone: '+525512345678', purpose: 'link_email', code: '111111' });
    expect(r).toEqual({ ok: false, reason: 'mismatch' });
    expect(db.query).toHaveBeenCalledTimes(2); // select + attempts++
    expect(db.query.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);
  });

  it('consumes the row and returns the client on a correct code', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, client_id: 7, organization_id: 3, code_hash: wa.hashCode('123456'), attempts: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await wa.verifyPhoneCode({ phone: '+525512345678', purpose: 'link_email', code: '123456' });
    expect(r).toEqual({ ok: true, clientId: 7, organizationId: 3 });
    expect(db.query.mock.calls[1][0]).toMatch(/consumed_at = NOW\(\)/);
  });
});

describe('verifyPortalCode', () => {
  it('returns no_match when no pending portal code hashes to the value', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const r = await wa.verifyPortalCode({ code: '12345678' });
    expect(r).toEqual({ ok: false, reason: 'no_match' });
  });
  it('consumes and returns the client on a match', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9, client_id: 5, organization_id: 2 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await wa.verifyPortalCode({ code: '12345678' });
    expect(r).toEqual({ ok: true, clientId: 5, organizationId: 2 });
  });

  it('refuses to bind (ambiguous) when a code collides across two clients', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 9, client_id: 5, organization_id: 2 },
      { id: 10, client_id: 6, organization_id: 3 },
    ]]);
    const r = await wa.verifyPortalCode({ code: '12345678' });
    expect(r).toEqual({ ok: false, reason: 'ambiguous' });
    expect(db.query).toHaveBeenCalledTimes(1); // never consumed anything
  });
});

describe('redactSecrets', () => {
  it('masks digit runs (codes / phone numbers) but keeps the rest', () => {
    expect(wa.redactSecrets('my code is 12345678 thanks')).toBe('my code is •••••••• thanks');
    expect(wa.redactSecrets('call 5215512345678')).toBe('call •••••••••••••');
    expect(wa.redactSecrets('hello there')).toBe('hello there');
    expect(wa.redactSecrets(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('bindNumber', () => {
  it('revokes any existing active binding then inserts, in one transaction', async () => {
    const conn = {
      beginTransaction: jest.fn(), execute: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])   // revoke
      .mockResolvedValueOnce([{ insertId: 42 }]);      // insert
    db.getConnection.mockResolvedValue(conn);

    const r = await wa.bindNumber({ organizationId: 3, clientId: 7, phone: '+525512345678', via: 'portal' });
    expect(r).toEqual({ id: 42 });
    expect(conn.execute.mock.calls[0][0]).toMatch(/UPDATE whatsapp_links SET status = 'revoked'/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/INSERT INTO whatsapp_links/);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('rolls back on error', async () => {
    const conn = {
      beginTransaction: jest.fn(), execute: jest.fn().mockRejectedValue(new Error('boom')),
      commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
    await expect(wa.bindNumber({ clientId: 7, phone: '+525512345678', via: 'portal' })).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe('recordInbound', () => {
  it('reports isNew=true when the row inserts', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await wa.recordInbound({ provider: 'meta', providerMessageId: 'm1', phone: '+521' })).toEqual({ isNew: true });
  });
  it('reports isNew=false on a duplicate (INSERT IGNORE no-op)', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await wa.recordInbound({ provider: 'meta', providerMessageId: 'm1', phone: '+521' })).toEqual({ isNew: false });
  });
});

// ---------------------------------------------------------------------------
describe('webhook signature verification', () => {
  it('verifyMetaSignature accepts a correct HMAC and rejects tampering / missing prefix', () => {
    const secret = 'app-secret';
    const body = '{"hello":"world"}';
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(webhookSvc.verifyMetaSignature(body, sig, secret)).toBe(true);
    expect(webhookSvc.verifyMetaSignature(body + 'x', sig, secret)).toBe(false);
    expect(webhookSvc.verifyMetaSignature(body, sig.replace('sha256=', ''), secret)).toBe(false);
    expect(webhookSvc.verifyMetaSignature(body, undefined, secret)).toBe(false);
  });

  it('verifyTwilioSignature accepts a correctly-signed request and rejects tampering', () => {
    const token = 'twilio-token';
    const req = {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'isp.example.com' },
      originalUrl: '/api/v1/whatsapp/webhook',
      body: { From: 'whatsapp:+5215512345678', Body: 'hola', MessageSid: 'SM1' },
    };
    const url = 'https://isp.example.com/api/v1/whatsapp/webhook';
    const data = Object.keys(req.body).sort().reduce((a, k) => a + k + req.body[k], url);
    const sig = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');

    req.headers['x-twilio-signature'] = sig;
    expect(webhookSvc.verifyTwilioSignature(req, token)).toBe(true);
    req.headers['x-twilio-signature'] = sig.slice(0, -2) + 'xx';
    expect(webhookSvc.verifyTwilioSignature(req, token)).toBe(false);
  });

  it('metaChallenge echoes the challenge only with the right verify token', () => {
    const prev = config.whatsapp.verifyToken;
    config.whatsapp.verifyToken = 'vtok';
    expect(webhookSvc.metaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vtok', 'hub.challenge': 'ABC' })).toBe('ABC');
    expect(webhookSvc.metaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'ABC' })).toBeNull();
    config.whatsapp.verifyToken = prev;
  });

  it('parseInboundMessages extracts Meta text messages and ignores status callbacks', () => {
    const metaMsg = { body: { entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15551230000' },
      messages: [{ id: 'wamid.1', from: '5215512345678', type: 'text', text: { body: 'hi' } }],
    } }] }] } };
    expect(webhookSvc.parseInboundMessages('meta', metaMsg)).toEqual([
      { providerMessageId: 'wamid.1', from: '5215512345678', to: '15551230000', body: 'hi' },
    ]);
    const statusOnly = { body: { entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] } };
    expect(webhookSvc.parseInboundMessages('meta', statusOnly)).toEqual([]);
  });

  it('parseInboundMessages extracts a Twilio message and rejects a probe', () => {
    expect(webhookSvc.parseInboundMessages('twilio', { body: { MessageSid: 'SM1', From: 'whatsapp:+521', Body: 'yo' } }))
      .toEqual([{ providerMessageId: 'SM1', from: 'whatsapp:+521', to: null, body: 'yo' }]);
    expect(webhookSvc.parseInboundMessages('twilio', { body: { junk: 1 } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/v1/whatsapp/webhook (fail-closed wiring)', () => {
  const request = require('supertest');
  const app = require('../src/app');
  const outbound = require('../src/services/whatsappOutbound');
  jest.spyOn(outbound, 'sendReply').mockResolvedValue({ success: true });

  const saved = {};
  beforeEach(() => {
    saved.provider = config.whatsapp.provider;
    saved.appSecret = config.whatsapp.appSecret;
    saved.token = process.env.TWILIO_AUTH_TOKEN;
  });
  afterEach(() => {
    config.whatsapp.provider = saved.provider;
    config.whatsapp.appSecret = saved.appSecret;
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = saved.token;
  });

  it('503 when no provider is configured', async () => {
    config.whatsapp.provider = 'auto';
    config.whatsapp.appSecret = '';
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await request(app).post('/api/v1/whatsapp/webhook').send({ any: 'thing' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  it('401 when the Meta signature is invalid', async () => {
    config.whatsapp.provider = 'meta';
    config.whatsapp.appSecret = 'app-secret';
    const res = await request(app)
      .post('/api/v1/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send('{"entry":[]}');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('200 and dedups on a correctly-signed Meta payload', async () => {
    config.whatsapp.provider = 'meta';
    config.whatsapp.appSecret = 'app-secret';
    const payload = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15551230000' },
      messages: [{ id: 'wamid.dup', from: '5215512345678', type: 'text', text: { body: 'hi' } }],
    } }] }] });
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(payload, 'utf8').digest('hex');
    // recordInbound -> INSERT IGNORE returns affectedRows:0 (treat as duplicate) so
    // no bot/outbound work happens; the route should still 200.
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    const res = await request(app)
      .post('/api/v1/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(outbound.sendReply).not.toHaveBeenCalled(); // duplicate -> skipped
  });

  it('GET challenge echoes only with the correct verify token', async () => {
    const prev = config.whatsapp.verifyToken;
    config.whatsapp.verifyToken = 'vtok';
    const ok = await request(app).get('/api/v1/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vtok', 'hub.challenge': 'PING' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('PING');
    const bad = await request(app).get('/api/v1/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'PING' });
    expect(bad.status).toBe(403);
    config.whatsapp.verifyToken = prev;
  });
});
