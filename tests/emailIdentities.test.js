// =============================================================================
// FireISP 5.0 — Per-function email identity routes (migration 407)
// =============================================================================
// GET  /organizations/:id/email-settings          — list all 4 identities
// PUT  /organizations/:id/email-settings/:function — upsert one identity
// POST /organizations/:id/email-settings/:function/test — test one identity
//
// Exercises the real model + service + route chain against a stateful DB fake
// keyed by (organization_id, email_function), asserting each function is an
// independent row and the encrypted secret is never returned.
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
jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => mockEncrypt(v),
  decrypt: (v) => (typeof v === 'string' ? v.replace('enc:', '') : v),
}));

const mockSendEmail = jest.fn();
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: (...a) => mockSendEmail(...a),
  invalidateOrgTransport: jest.fn(),
  getOrgTransport: jest.fn(),
  init: jest.fn(),
  processQueue: jest.fn(),
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/app');

// store[`${orgId}:${fn}`] = row
let store;
function resetStore() { store = {}; }

function installDbMock() {
  db.query.mockImplementation((sql, params = []) => {
    if (sql.includes('INSERT INTO organization_email_settings') && sql.includes('last_test_at')) {
      const [orgId, fn, status, error] = params;
      const key = `${orgId}:${fn}`;
      store[key] = store[key] || { id: 1, organization_id: orgId, email_function: fn };
      Object.assign(store[key], { last_test_status: status, last_test_error: error, last_test_at: '2026-01-02T00:00:00.000Z' });
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (sql.includes('INSERT INTO organization_email_settings')) {
      const [organization_id, email_function, enabled, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_password_encrypted, from_email, from_name] = params;
      store[`${organization_id}:${email_function}`] = {
        id: 1, organization_id, email_function, enabled, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_password_encrypted, from_email, from_name,
        last_test_at: null, last_test_status: null, last_test_error: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      return Promise.resolve([{ insertId: 1 }]);
    }
    // findRawByOrgId: WHERE organization_id = ? AND email_function = ?
    if (sql.includes('SELECT * FROM organization_email_settings') && sql.includes('email_function = ?')) {
      const [orgId, fn] = params;
      const row = store[`${orgId}:${fn}`];
      return Promise.resolve([row ? [row] : []]);
    }
    // listByOrgId: WHERE organization_id = ?
    if (sql.includes('SELECT * FROM organization_email_settings')) {
      const [orgId] = params;
      const rows = Object.entries(store)
        .filter(([k]) => k.startsWith(`${orgId}:`))
        .map(([, v]) => v);
      return Promise.resolve([rows]);
    }
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  installDbMock();
});

describe('GET /api/v1/organizations/:id/email-settings', () => {
  it('returns one identity per function (general/support/billing/noc), all default-empty', async () => {
    const res = await request(app).get('/api/v1/organizations/1/email-settings');
    expect(res.status).toBe(200);
    const functions = res.body.data.map(d => d.email_function);
    expect(functions).toEqual(['general', 'support', 'billing', 'noc']);
    expect(res.body.data.every(d => d.configured === false)).toBe(true);
  });
});

describe('PUT /api/v1/organizations/:id/email-settings/:function', () => {
  it('upserts only the addressed function and encrypts the secret', async () => {
    const res = await request(app)
      .put('/api/v1/organizations/1/email-settings/billing')
      .send({ enabled: true, smtp_host: 'billing.smtp', smtp_user: 'bu', smtp_password: 'secret', from_email: 'billing@isp.mx' });
    expect(res.status).toBe(200);
    expect(res.body.data.email_function).toBe('billing');
    expect(mockEncrypt).toHaveBeenCalledWith('secret');
    expect(store['1:billing'].smtp_password_encrypted).toBe('enc:secret');
    // support/general untouched
    expect(store['1:support']).toBeUndefined();
    expect(store['1:general']).toBeUndefined();
    // secret never in the response
    expect(JSON.stringify(res.body)).not.toContain('enc:secret');
  });

  it('keeps functions independent — billing and support hold different addresses', async () => {
    await request(app).put('/api/v1/organizations/1/email-settings/billing')
      .send({ enabled: true, smtp_host: 'b.smtp', from_email: 'billing@isp.mx' });
    await request(app).put('/api/v1/organizations/1/email-settings/support')
      .send({ enabled: true, smtp_host: 's.smtp', from_email: 'support@isp.mx' });

    const list = (await request(app).get('/api/v1/organizations/1/email-settings')).body.data;
    expect(list.find(d => d.email_function === 'billing').from_email).toBe('billing@isp.mx');
    expect(list.find(d => d.email_function === 'support').from_email).toBe('support@isp.mx');
  });

  it('rejects an unknown function with 422', async () => {
    const res = await request(app)
      .put('/api/v1/organizations/1/email-settings/marketing')
      .send({ enabled: true, smtp_host: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Unknown email function/);
  });
});

describe('POST /api/v1/organizations/:id/email-settings/:function/test', () => {
  it('sends a test email through the addressed function and records the result', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: true, messageId: '<t@test>' });
    const res = await request(app)
      .post('/api/v1/organizations/1/email-settings/noc/test')
      .send({ to: 'ops@isp.mx' });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ emailFunction: 'noc', to: 'ops@isp.mx' }));
    expect(store['1:noc'].last_test_status).toBe('success');
  });

  it('returns 200 with success:false when the send fails, recording the error', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'SMTP refused' });
    const res = await request(app)
      .post('/api/v1/organizations/1/email-settings/support/test')
      .send({ to: 'help@isp.mx' });
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(false);
    expect(store['1:support'].last_test_status).toBe('failed');
    expect(store['1:support'].last_test_error).toBe('SMTP refused');
  });

  it('rejects a test for an unknown function with 422', async () => {
    const res = await request(app)
      .post('/api/v1/organizations/1/email-settings/marketing/test')
      .send({ to: 'x@isp.mx' });
    expect(res.status).toBe(422);
  });
});
