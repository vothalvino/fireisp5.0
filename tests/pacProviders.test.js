// =============================================================================
// FireISP 5.0 — PAC Provider Route Tests
// =============================================================================
// Regression coverage for the secret-redaction fix (same vulnerability class
// as src/routes/paymentGateways.js): username_encrypted, password_encrypted,
// api_key_encrypted and token_encrypted hold ciphertext at rest — but
// src/utils/encryption.js's encrypt()/decrypt() are transparent no-ops when
// ENCRYPTION_KEY is unset, so these columns can hold PLAINTEXT PAC account
// credentials. GET/POST/PUT must never return any of them verbatim.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/PacProvider');
jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const PacProvider = require('../src/models/PacProvider');
const User = require('../src/models/User');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const adminToken = makeToken();

function mockAdminUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'admin@test.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
  // requireMxLocale (mounted ahead of the CRUD routes) needs an MX-locale org.
  db.query.mockResolvedValue([[{ locale: 'MX' }]]);
}

const rawProviderRow = {
  id: 4,
  organization_id: 1,
  provider_name: 'finkok',
  label: 'Finkok Producción',
  environment: 'production',
  username_encrypted: 'PLAINTEXT_USERNAME',
  password_encrypted: 'PLAINTEXT_PASSWORD',
  api_key_encrypted: 'PLAINTEXT_API_KEY',
  token_encrypted: 'PLAINTEXT_TOKEN',
  api_url: 'https://facturacion.finkok.com',
  is_default: 1,
  status: 'active',
};

function assertRedacted(body) {
  ['username_encrypted', 'password_encrypted', 'api_key_encrypted', 'token_encrypted'].forEach((f) => {
    expect(body).not.toHaveProperty(f);
  });
  expect(JSON.stringify(body)).not.toContain('PLAINTEXT');
}

describe('PAC Provider routes — secret redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  test('GET /api/v1/pac-providers (list) never leaks credentials', async () => {
    PacProvider.findAll.mockResolvedValue([rawProviderRow]);
    PacProvider.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/pac-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data[0]);
    expect(res.body.data[0]).toMatchObject({
      has_username: true,
      has_password: true,
      has_api_key: true,
      has_token: true,
    });
    expect(res.body.data[0].provider_name).toBe('finkok');
  });

  test('GET /api/v1/pac-providers/:id never leaks credentials', async () => {
    PacProvider.findByIdOrFail.mockResolvedValue(rawProviderRow);

    const res = await request(app)
      .get('/api/v1/pac-providers/4')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data);
  });

  test('has_* booleans are false for unset credential columns', async () => {
    PacProvider.findByIdOrFail.mockResolvedValue({
      ...rawProviderRow,
      api_key_encrypted: null,
      token_encrypted: null,
    });

    const res = await request(app)
      .get('/api/v1/pac-providers/4')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.body.data.has_api_key).toBe(false);
    expect(res.body.data.has_token).toBe(false);
    expect(res.body.data.has_username).toBe(true);
    expect(res.body.data.has_password).toBe(true);
  });

  test('POST /api/v1/pac-providers never leaks credentials in the 201 response', async () => {
    PacProvider.create.mockResolvedValue(rawProviderRow);

    const res = await request(app)
      .post('/api/v1/pac-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        provider_name: 'finkok',
        label: 'Finkok prueba',
        api_url: 'https://demo-facturacion.finkok.com',
        username_encrypted: 'PLAINTEXT_USERNAME',
        password_encrypted: 'PLAINTEXT_PASSWORD',
      });

    expect(res.status).toBe(201);
    assertRedacted(res.body.data);
    expect(PacProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({ username_encrypted: 'PLAINTEXT_USERNAME', password_encrypted: 'PLAINTEXT_PASSWORD' }),
    );
  });
});

// ===========================================================================
// Active fiscal environment switch (GET/PUT /pac-providers/environment)
// ===========================================================================
describe('PAC Provider fiscal-environment switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({ id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1 });
  });

  // Route the queries the endpoint makes (requireMxLocale's locale lookup, the
  // org_mx_profiles read/existence/update, and the production-PAC readiness
  // check). `profileRow` = the org's stored pac_environment row (or null for
  // none); `hasProdPac` = whether an active production PAC exists.
  function wireEnv({ profileRow, hasProdPac = true }) {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT locale FROM organizations/i.test(sql)) return [[{ locale: 'MX' }]];
      if (/SELECT pac_environment FROM organization_mx_profiles/i.test(sql)) return [profileRow ? [profileRow] : []];
      if (/SELECT id FROM organization_mx_profiles/i.test(sql)) return [profileRow ? [{ id: 3 }] : []];
      if (/FROM pac_providers.*environment = 'production'/is.test(sql)) return [hasProdPac ? [{ id: 9 }] : []];
      if (/UPDATE organization_mx_profiles/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
  }

  test('GET returns the stored environment', async () => {
    wireEnv({ profileRow: { pac_environment: 'production' } });
    const res = await request(app).get('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.pac_environment).toBe('production');
  });

  test('GET defaults to sandbox when the org has no fiscal profile yet', async () => {
    wireEnv({ profileRow: null });
    const res = await request(app).get('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.pac_environment).toBe('sandbox');
  });

  test('PUT updates the environment when a profile exists', async () => {
    wireEnv({ profileRow: { pac_environment: 'sandbox' } });
    const res = await request(app).put('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1')
      .send({ pac_environment: 'production' });
    expect(res.status).toBe(200);
    expect(res.body.data.pac_environment).toBe('production');
    const update = db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/i.test(c[0]));
    expect(update[1]).toEqual(['production', 1]);
  });

  test('PUT rejects an invalid value (422) without writing', async () => {
    wireEnv({ profileRow: { pac_environment: 'sandbox' } });
    const res = await request(app).put('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1')
      .send({ pac_environment: 'staging' });
    expect(res.status).toBe(422);
    expect(db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/i.test(c[0]))).toBeFalsy();
  });

  test('PUT 422s with an actionable code when there is no fiscal profile yet', async () => {
    wireEnv({ profileRow: null });
    const res = await request(app).put('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1')
      .send({ pac_environment: 'production' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_MX_PROFILE_MISSING');
    expect(db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/i.test(c[0]))).toBeFalsy();
  });

  test('PUT to production is refused (422 NO_PRODUCTION_PAC) when no active production PAC exists', async () => {
    wireEnv({ profileRow: { pac_environment: 'sandbox' }, hasProdPac: false });
    const res = await request(app).put('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1')
      .send({ pac_environment: 'production' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PRODUCTION_PAC');
    expect(db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/i.test(c[0]))).toBeFalsy();
  });

  test('PUT back to sandbox needs no production PAC (no readiness gate)', async () => {
    wireEnv({ profileRow: { pac_environment: 'production' }, hasProdPac: false });
    const res = await request(app).put('/api/v1/pac-providers/environment')
      .set('Authorization', `Bearer ${adminToken}`).set('X-Org-Id', '1')
      .send({ pac_environment: 'sandbox' });
    expect(res.status).toBe(200);
    expect(res.body.data.pac_environment).toBe('sandbox');
  });
});
