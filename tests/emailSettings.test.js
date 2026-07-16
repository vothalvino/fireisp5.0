// =============================================================================
// FireISP 5.0 — Email Settings (per-org SMTP config) Tests
// =============================================================================
// Covers src/models/EmailSettings.js, src/services/emailSettingsService.js,
// and src/routes/emailSettings.js (GET/PUT /email-settings, POST /test).
//
// Security-critical properties under test:
//   - smtp_password_encrypted is NEVER present in any HTTP response body
//   - PUT's three-state password contract: omitted=keep, ''=clear, value=replace
//   - encrypt() is called with the plaintext password — the raw value is
//     never persisted as-is
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const mockEncrypt = jest.fn((v) => `enc:${v}`);
const mockDecrypt = jest.fn((v) => (typeof v === 'string' ? v.replace('enc:', '') : v));
jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => mockEncrypt(v),
  decrypt: (v) => mockDecrypt(v),
}));

// sendEmail is mocked at the module level for route tests (POST /test) —
// EmailSettings.upsert() also calls invalidateOrgTransport(), so every
// export the module normally has must be present here.
const mockSendEmail = jest.fn();
const mockInvalidateOrgTransport = jest.fn();
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: (...a) => mockSendEmail(...a),
  invalidateOrgTransport: (...a) => mockInvalidateOrgTransport(...a),
  getOrgTransport: jest.fn(),
  init: jest.fn(),
  processQueue: jest.fn(),
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/app');
const EmailSettings = require('../src/models/EmailSettings');

// ---------------------------------------------------------------------------
// A tiny stateful fake for organization_email_settings, keyed by org id, so
// PUT -> GET round-trips actually persist across calls within a test (real
// model/service code runs against this, not a hand-mocked response shape).
// ---------------------------------------------------------------------------
let store;

function resetStore() {
  store = {};
}

function installDbMock() {
  db.query.mockImplementation((sql, params = []) => {
    if (sql.includes('SELECT * FROM organization_email_settings')) {
      const orgId = params[0];
      const row = store[orgId];
      return Promise.resolve([row ? [row] : []]);
    }
    if (sql.includes('INSERT INTO organization_email_settings')) {
      const [
        organization_id, enabled, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_password_encrypted, from_email, from_name,
      ] = params;
      store[organization_id] = {
        id: 1, organization_id, enabled, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_password_encrypted, from_email, from_name,
        last_test_at: null, last_test_status: null, last_test_error: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (sql.includes('UPDATE organization_email_settings') && sql.includes('last_test_at')) {
      const [status, error, orgId] = params;
      if (store[orgId]) {
        store[orgId].last_test_status = status;
        store[orgId].last_test_error = error;
        store[orgId].last_test_at = '2026-01-02T00:00:00.000Z';
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    }
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  installDbMock();
});

// =============================================================================
// GET /api/v1/email-settings
// =============================================================================
describe('GET /api/v1/email-settings', () => {
  it('returns a safe default (configured:false) when no config exists for the org', async () => {
    const res = await request(app).get('/api/v1/email-settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ organization_id: 1, configured: false, enabled: false });
    expect(res.body.data).not.toHaveProperty('smtp_password_encrypted');
  });

  it('never includes smtp_password_encrypted in the response, even once configured', async () => {
    store[1] = {
      id: 1, organization_id: 1, enabled: 1, smtp_host: 'smtp.example.com', smtp_port: 587,
      smtp_secure: 0, smtp_user: 'user@example.com', smtp_password_encrypted: 'enc:supersecret',
      from_email: 'noreply@example.com', from_name: 'Example ISP',
      last_test_at: null, last_test_status: null, last_test_error: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };

    const res = await request(app).get('/api/v1/email-settings');
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data).not.toHaveProperty('smtp_password_encrypted');
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
  });
});

// =============================================================================
// PUT /api/v1/email-settings — three-state password contract
// =============================================================================
describe('PUT /api/v1/email-settings', () => {
  it('creates a config and encrypts the password when smtp_password is set', async () => {
    const res = await request(app)
      .put('/api/v1/email-settings')
      .send({
        enabled: true, smtp_host: 'smtp.example.com', smtp_port: 587, smtp_secure: false,
        smtp_user: 'user@example.com', smtp_password: 'hunter2',
        from_email: 'noreply@example.com', from_name: 'Example ISP',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data).not.toHaveProperty('smtp_password_encrypted');
    expect(mockEncrypt).toHaveBeenCalledWith('hunter2');
    // The raw plaintext must never be what's persisted.
    expect(store[1].smtp_password_encrypted).toBe('enc:hunter2');
    expect(store[1].smtp_password_encrypted).not.toBe('hunter2');
  });

  it('invalidates the cached org transport on save', async () => {
    await request(app).put('/api/v1/email-settings').send({ smtp_password: 'hunter2' });
    expect(mockInvalidateOrgTransport).toHaveBeenCalledWith(1);
  });

  it('omitting smtp_password on a later PUT keeps the existing encrypted value', async () => {
    await request(app).put('/api/v1/email-settings').send({ smtp_host: 'a.example.com', smtp_password: 'hunter2' });
    expect(store[1].smtp_password_encrypted).toBe('enc:hunter2');

    const res = await request(app).put('/api/v1/email-settings').send({ smtp_host: 'b.example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.smtp_host).toBe('b.example.com');
    expect(res.body.data.configured).toBe(true);
    expect(store[1].smtp_password_encrypted).toBe('enc:hunter2');
  });

  it('smtp_password:"" clears the stored credential', async () => {
    await request(app).put('/api/v1/email-settings').send({ smtp_password: 'hunter2' });
    expect(store[1].smtp_password_encrypted).toBe('enc:hunter2');

    const res = await request(app).put('/api/v1/email-settings').send({ smtp_password: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(store[1].smtp_password_encrypted).toBeNull();
  });

  it('a PUT then a follow-up GET reflects configured:true', async () => {
    await request(app).put('/api/v1/email-settings').send({ smtp_password: 'hunter2', smtp_host: 'smtp.example.com' });
    const res = await request(app).get('/api/v1/email-settings');
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.smtp_host).toBe('smtp.example.com');
  });

  it('rejects a non-boolean enabled with 422', async () => {
    const res = await request(app).put('/api/v1/email-settings').send({ enabled: 'yes' });
    expect(res.status).toBe(422);
  });

  it('rejects an invalid from_email with 422', async () => {
    const res = await request(app).put('/api/v1/email-settings').send({ from_email: 'not-an-email' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// POST /api/v1/email-settings/test
// =============================================================================
describe('POST /api/v1/email-settings/test', () => {
  beforeEach(async () => {
    // Seed a config row so recordTestResult() has something to update.
    await request(app).put('/api/v1/email-settings').send({ smtp_password: 'hunter2', smtp_host: 'smtp.example.com' });
    jest.clearAllMocks();
  });

  it('sends the test email and records a success result', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: true, messageId: '<test@x>' });

    const res = await request(app).post('/api/v1/email-settings/test').send({ to: 'me@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true, messageId: '<test@x>' });
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, to: 'me@example.com', subject: expect.stringContaining('Test'),
    }));
    expect(store[1].last_test_status).toBe('success');
  });

  it('returns 200 (not 500) with success:false when the send fails, and records the error', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'Connection refused' });

    const res = await request(app).post('/api/v1/email-settings/test').send({ to: 'me@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: false, error: 'Connection refused' });
    expect(store[1].last_test_status).toBe('failed');
    expect(store[1].last_test_error).toBe('Connection refused');
  });

  it('rejects a missing "to" with 422', async () => {
    const res = await request(app).post('/api/v1/email-settings/test').send({});
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// EmailSettings model — direct unit coverage
// =============================================================================
describe('EmailSettings model', () => {
  it('toPublic() never includes smtp_password_encrypted', () => {
    const pub = EmailSettings.toPublic({
      organization_id: 5, enabled: 1, smtp_host: 'h', smtp_port: 587, smtp_secure: 0,
      smtp_user: 'u', smtp_password_encrypted: 'enc:secret', from_email: 'f@x.com', from_name: 'F',
    });
    expect(pub).not.toHaveProperty('smtp_password_encrypted');
    expect(pub.configured).toBe(true);
  });

  it('defaultForOrg() reports configured:false', () => {
    const def = EmailSettings.defaultForOrg(9);
    expect(def.configured).toBe(false);
    expect(def).not.toHaveProperty('smtp_password_encrypted');
  });

  it('findByOrgId() on a non-existent org returns the default (configured:false)', async () => {
    const result = await EmailSettings.findByOrgId(999);
    expect(result.configured).toBe(false);
    expect(result.organization_id).toBe(999);
  });
});
