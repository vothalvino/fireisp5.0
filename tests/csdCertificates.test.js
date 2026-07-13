// =============================================================================
// FireISP 5.0 — CSD Certificate Route Tests
// =============================================================================
// Regression coverage for the secret-redaction fix (same vulnerability class
// as src/routes/paymentGateways.js): key_pem_encrypted holds the CSD PRIVATE
// KEY used to digitally sign CFDI documents — src/utils/encryption.js's
// encrypt()/decrypt() are transparent no-ops when ENCRYPTION_KEY is unset, so
// this column can hold a PLAINTEXT private key. GET/POST/PUT must never
// return key_pem_encrypted / passphrase_encrypted verbatim.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/CsdCertificate');
jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const CsdCertificate = require('../src/models/CsdCertificate');
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
  // requireMxLocale (mounted ahead of the CRUD routes) calls
  // Organization.getLocale(req.orgId), which is a raw `db.query` — the org
  // must be locale='MX' or every request 404s as REGION_DISABLED.
  db.query.mockResolvedValue([[{ locale: 'MX' }]]);
}

const rawCertRow = {
  id: 3,
  organization_id: 1,
  cer_pem: '-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----',
  key_pem_encrypted: 'PLAINTEXT_PRIVATE_KEY_PEM',
  passphrase_encrypted: 'PLAINTEXT_PASSPHRASE',
  fingerprint_sha256: 'abc123',
  certificate_number: '00001000000500000123',
  rfc: 'AAA010101AAA',
  valid_from: '2026-01-01',
  valid_to: '2030-01-01',
  status: 'active',
};

function assertRedacted(body) {
  expect(body).not.toHaveProperty('key_pem_encrypted');
  expect(body).not.toHaveProperty('passphrase_encrypted');
  expect(JSON.stringify(body)).not.toContain('PLAINTEXT');
}

describe('CSD Certificate routes — secret redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  test('GET /api/v1/csd-certificates (list) never leaks the private key or passphrase', async () => {
    CsdCertificate.findAll.mockResolvedValue([rawCertRow]);
    CsdCertificate.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data[0]);
    expect(res.body.data[0]).toMatchObject({ has_key_pem: true, has_passphrase: true });
    // The public certificate is NOT secret and must still be present.
    expect(res.body.data[0].cer_pem).toContain('BEGIN CERTIFICATE');
  });

  test('GET /api/v1/csd-certificates/:id never leaks the private key or passphrase', async () => {
    CsdCertificate.findByIdOrFail.mockResolvedValue(rawCertRow);

    const res = await request(app)
      .get('/api/v1/csd-certificates/3')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data);
  });

  test('has_passphrase is false when no passphrase is configured', async () => {
    CsdCertificate.findByIdOrFail.mockResolvedValue({ ...rawCertRow, passphrase_encrypted: null });

    const res = await request(app)
      .get('/api/v1/csd-certificates/3')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.body.data.has_key_pem).toBe(true);
    expect(res.body.data.has_passphrase).toBe(false);
  });

  test('POST /api/v1/csd-certificates never leaks the private key in the 201 response', async () => {
    CsdCertificate.create.mockResolvedValue(rawCertRow);

    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        cer_pem: rawCertRow.cer_pem,
        key_pem_encrypted: 'PLAINTEXT_PRIVATE_KEY_PEM',
        rfc: 'AAA010101AAA',
      });

    expect(res.status).toBe(201);
    assertRedacted(res.body.data);
    expect(CsdCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({ key_pem_encrypted: 'PLAINTEXT_PRIVATE_KEY_PEM' }),
    );
  });
});
