// =============================================================================
// FireISP 5.0 — SMS Transport Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Spy on https.request to capture Twilio calls without hitting the network
const https = require('https');
const http  = require('http');
jest.spyOn(https, 'request');
jest.spyOn(http, 'request');

const db           = require('../src/config/database');
const smsTransport = require('../src/services/smsTransport');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake https.request that resolves with the given response.
 */
function mockHttpsRequest({ statusCode = 200, body = '{}' } = {}) {
  const { EventEmitter } = require('events');

  https.request.mockImplementationOnce((_opts, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end   = jest.fn().mockImplementation(() => {
      callback(res);
      res.emit('data', body);
      res.emit('end');
    });
    req.destroy = jest.fn().mockImplementation((err) => req.emit('error', err));
    return req;
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Reset env so tests start from a clean slate
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM;
  delete process.env.SMS_PROVIDER;
  delete process.env.SMS_PROVIDER_URL;
  delete process.env.SMS_PROVIDER_API_KEY;
});

// ---------------------------------------------------------------------------
// detectProvider()
// ---------------------------------------------------------------------------
describe('detectProvider()', () => {
  test('returns null when no env vars are set', () => {
    expect(smsTransport.detectProvider()).toBeNull();
  });

  test('returns "twilio" when Twilio credentials are present', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN  = 'token';
    expect(smsTransport.detectProvider()).toBe('twilio');
  });

  test('returns "generic" when SMS_PROVIDER=generic and URL is set', () => {
    process.env.SMS_PROVIDER     = 'generic';
    process.env.SMS_PROVIDER_URL = 'https://sms.example.com/send';
    expect(smsTransport.detectProvider()).toBe('generic');
  });

  test('returns "generic" when only SMS_PROVIDER_URL is set (no Twilio)', () => {
    process.env.SMS_PROVIDER_URL = 'https://sms.example.com/send';
    expect(smsTransport.detectProvider()).toBe('generic');
  });

  test('prefers "generic" over Twilio when SMS_PROVIDER=generic is explicit', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN  = 'token';
    process.env.SMS_PROVIDER       = 'generic';
    process.env.SMS_PROVIDER_URL   = 'https://sms.example.com/send';
    expect(smsTransport.detectProvider()).toBe('generic');
  });
});

// ---------------------------------------------------------------------------
// sendSms() — no provider configured
// ---------------------------------------------------------------------------
describe('sendSms() — no provider', () => {
  test('logs failure and returns success:false when no provider configured', async () => {
    // DB insert should still happen
    db.query.mockResolvedValueOnce([{ insertId: 99 }]);

    const result = await smsTransport.sendSms({
      organizationId: 1,
      to:   '+521234567890',
      body: 'Test message',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No SMS provider/i);

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO sms_logs/i);
    expect(params).toContain('failed');
    expect(params).toContain('+521234567890');
  });
});

// ---------------------------------------------------------------------------
// sendSms() — Twilio success
// ---------------------------------------------------------------------------
describe('sendSms() — Twilio success', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN  = 'authtoken';
    process.env.TWILIO_FROM        = '+15005550001';
  });

  test('sends via Twilio and logs sent status', async () => {
    mockHttpsRequest({
      statusCode: 201,
      body: JSON.stringify({ sid: 'SM123', status: 'queued' }),
    });

    db.query.mockResolvedValueOnce([{ insertId: 10 }]);

    const result = await smsTransport.sendSms({
      organizationId: 1,
      clientId: 5,
      to:   '+521234567890',
      body: 'Hello!',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('SM123');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO sms_logs/);
    expect(params).toContain('twilio');
    expect(params).toContain('SM123');
    expect(params).toContain('sent');
  });

  test('records failure when Twilio returns HTTP 400', async () => {
    mockHttpsRequest({
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid phone number', code: 21211 }),
    });

    db.query.mockResolvedValueOnce([{ insertId: 11 }]);

    const result = await smsTransport.sendSms({
      organizationId: 1,
      to:   '+52invalid',
      body: 'Hello!',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid phone number/);

    const [, params] = db.query.mock.calls[0];
    expect(params).toContain('failed');
  });

  test('sends WhatsApp via Twilio with whatsapp: prefix', async () => {
    mockHttpsRequest({
      statusCode: 201,
      body: JSON.stringify({ sid: 'SM456', status: 'sent' }),
    });

    db.query.mockResolvedValueOnce([{ insertId: 12 }]);

    const result = await smsTransport.sendSms({
      organizationId: 1,
      to:      '+521234567890',
      body:    'WA message',
      channel: 'whatsapp',
    });

    expect(result.success).toBe(true);

    // Verify the https.request was called with Twilio hostname
    const [[requestOpts]] = https.request.mock.calls;
    expect(requestOpts.hostname).toBe('api.twilio.com');

    const [, params] = db.query.mock.calls[0];
    expect(params).toContain('whatsapp');
  });
});

// ---------------------------------------------------------------------------
// queueSms()
// ---------------------------------------------------------------------------
describe('queueSms()', () => {
  test('inserts a queued row without calling the provider', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN  = 'authtoken';

    db.query.mockResolvedValueOnce([{ insertId: 20 }]);

    const result = await smsTransport.queueSms({
      organizationId: 1,
      clientId: 3,
      to:   '+521234567890',
      body: 'Queued message',
    });

    expect(result.queued).toBe(true);
    expect(result.logId).toBe(20);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO sms_logs/);
    expect(sql).toMatch(/'queued'/);  // 'queued' is a literal in the INSERT

    // Provider should NOT have been called
    expect(https.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processQueue()
// ---------------------------------------------------------------------------
describe('processQueue()', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN  = 'authtoken';
    process.env.TWILIO_FROM        = '+15005550001';
  });

  test('sends all queued rows and returns counts', async () => {
    // SELECT queued rows
    db.query.mockResolvedValueOnce([[
      { id: 1, phone_number: '+521234567890', message_body: 'msg1', channel: 'sms' },
      { id: 2, phone_number: '+521234567891', message_body: 'msg2', channel: 'sms' },
    ]]);

    // Twilio success for row 1
    mockHttpsRequest({ statusCode: 201, body: JSON.stringify({ sid: 'SM1', status: 'queued' }) });
    // UPDATE success for row 1
    db.query.mockResolvedValueOnce([{}]);

    // Twilio success for row 2
    mockHttpsRequest({ statusCode: 201, body: JSON.stringify({ sid: 'SM2', status: 'queued' }) });
    // UPDATE success for row 2
    db.query.mockResolvedValueOnce([{}]);

    const result = await smsTransport.processQueue();

    expect(result.total).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  });

  test('handles partial failure gracefully', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 3, phone_number: '+521234567890', message_body: 'ok', channel: 'sms' },
      { id: 4, phone_number: '+52bad',         message_body: 'fail', channel: 'sms' },
    ]]);

    // Row 3 — success
    mockHttpsRequest({ statusCode: 201, body: JSON.stringify({ sid: 'SM3', status: 'queued' }) });
    db.query.mockResolvedValueOnce([{}]);

    // Row 4 — Twilio error
    mockHttpsRequest({ statusCode: 400, body: JSON.stringify({ message: 'Bad number', code: 21211 }) });
    db.query.mockResolvedValueOnce([{}]);

    const result = await smsTransport.processQueue();

    expect(result.total).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  test('returns zeros when queue is empty', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty queue

    const result = await smsTransport.processQueue();

    expect(result.total).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(https.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// retryLog()
// ---------------------------------------------------------------------------
describe('retryLog()', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN  = 'authtoken';
    process.env.TWILIO_FROM        = '+15005550001';
  });

  test('successfully retries a failed log', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 5, phone_number: '+521234567890', message_body: 'retry me', channel: 'sms', status: 'failed' },
    ]]);

    mockHttpsRequest({ statusCode: 201, body: JSON.stringify({ sid: 'SM5', status: 'sent' }) });
    db.query.mockResolvedValueOnce([{}]);

    const result = await smsTransport.retryLog(5);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('SM5');
  });

  test('throws if log not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // no rows

    await expect(smsTransport.retryLog(999)).rejects.toThrow('not found');
  });

  test('throws if log is not in a retryable state', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 6, phone_number: '+521234567890', message_body: 'sent', channel: 'sms', status: 'sent' },
    ]]);

    await expect(smsTransport.retryLog(6)).rejects.toThrow(/retryable/);
  });

  test('returns failure if provider rejects on retry', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 7, phone_number: '+52bad', message_body: 'bad number', channel: 'sms', status: 'failed' },
    ]]);

    mockHttpsRequest({ statusCode: 400, body: JSON.stringify({ message: 'Invalid number', code: 21211 }) });
    db.query.mockResolvedValueOnce([{}]);

    const result = await smsTransport.retryLog(7);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid number/);
  });
});
