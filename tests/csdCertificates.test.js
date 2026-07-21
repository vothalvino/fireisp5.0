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

  test('the legacy client-trusted create shape is rejected (422) — server parses the files now', async () => {
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        cer_pem: rawCertRow.cer_pem,
        key_pem_encrypted: 'PLAINTEXT_PRIVATE_KEY_PEM',
        rfc: 'AAA010101AAA',
      });
    expect(res.status).toBe(422);
  });
});

// ===========================================================================
// Real upload flow — uses the SAT public test CSD fixtures end-to-end
// (the seal service actually parses/validates them; only the DB is mocked).
// ===========================================================================
describe('CSD upload (real fixture, parsed server-side)', () => {
  const fs = require('fs');
  const path = require('path');
  const CER_B64 = fs.readFileSync(path.join(__dirname, 'fixtures/csd/EKU9003173C9.cer')).toString('base64');
  const KEY_B64 = fs.readFileSync(path.join(__dirname, 'fixtures/csd/EKU9003173C9.key')).toString('base64');

  let lastConn;
  function wireUploadDb({ orgRfc = 'EKU9003173C9', dup = null, actives = [] } = {}) {
    lastConn = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
    db.getConnection.mockResolvedValue(lastConn);
    db.query.mockImplementation(async (sql) => {
      if (/FROM organizations/.test(sql)) return [[{ locale: 'MX' }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [orgRfc ? [{ rfc: orgRfc }] : []];
      if (/INSERT INTO csd_certificates/.test(sql)) return [{ insertId: 11 }];
      if (/fingerprint_sha256/.test(sql)) return [dup ? [{ id: dup }] : []];
      if (/is_active = 1/.test(sql)) return [actives];
      return [[]];
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  test('uploads the raw .cer/.key, stores encrypted, responds with public info only', async () => {
    wireUploadDb();
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: '12345678a' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: 11, rfc: 'EKU9003173C9', certificate_number: '30001000000500003416',
      is_active: 1, is_test_certificate: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(res.body)).not.toContain('12345678a');
    const insert = db.query.mock.calls.find(c => /INSERT INTO csd_certificates/.test(c[0]));
    // key + passphrase params must be the (possibly no-op) encrypt() output —
    // never missing; cer_pem is public and stored plain
    expect(insert[1]).toEqual(expect.arrayContaining(['EKU9003173C9', '30001000000500003416']));
    // race-safe first-cert promotion: INSERT is inactive, then the same
    // zero-all-then-set-one transaction as /activate promotes it
    expect(insert[0]).toContain("0, 'active'");
    expect(lastConn.execute.mock.calls[0][0]).toContain('is_active = 0');
    expect(lastConn.execute.mock.calls[1][0]).toContain('is_active = 1');
    expect(lastConn.commit).toHaveBeenCalled();
  });

  test('delete clears is_active and restore always comes back inactive (single-active invariant)', async () => {
    wireUploadDb();
    CsdCertificate.findByIdOrFail.mockResolvedValue({ id: 4, organization_id: 1 });
    CsdCertificate.delete = jest.fn().mockResolvedValue(true);
    CsdCertificate.restore = jest.fn().mockResolvedValue({ id: 4, organization_id: 1, is_active: 0, status: 'active' });

    await request(app)
      .delete('/api/v1/csd-certificates/4')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');
    const delClear = db.query.mock.calls.find(c => /SET is_active = 0 WHERE id = \?/.test(c[0]));
    expect(delClear).toBeDefined();

    db.query.mockClear();
    await request(app)
      .post('/api/v1/csd-certificates/4/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');
    const resClear = db.query.mock.calls.find(c => /SET is_active = 0 WHERE id = \?/.test(c[0]));
    expect(resClear).toBeDefined();
  });

  test('422 CSD_RFC_MISMATCH when the CSD belongs to another RFC', async () => {
    wireUploadDb({ orgRfc: 'AAA010101AAA' });
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: '12345678a' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CSD_RFC_MISMATCH');
  });

  test('422 CSD_INVALID on a wrong passphrase', async () => {
    wireUploadDb();
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: 'nope' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CSD_INVALID');
  });

  test('409 CSD_DUPLICATE on the same fingerprint', async () => {
    wireUploadDb({ dup: 7 });
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: '12345678a' });
    expect(res.status).toBe(409);
  });

  test('a second certificate stays inactive until explicitly activated', async () => {
    wireUploadDb({ actives: [{ id: 5 }] });
    const res = await request(app)
      .post('/api/v1/csd-certificates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: '12345678a' });
    expect(res.status).toBe(201);
    expect(res.body.data.is_active).toBe(0);
  });

  test('production without ENCRYPTION_KEY: 422 ENCRYPTION_REQUIRED (never store plaintext keys)', async () => {
    wireUploadDb();
    const oldEnv = process.env.NODE_ENV;
    const oldKey = process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    try {
      const res = await request(app)
        .post('/api/v1/csd-certificates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1')
        .send({ cer_b64: CER_B64, key_b64: KEY_B64, passphrase: '12345678a' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ENCRYPTION_REQUIRED');
    } finally {
      process.env.NODE_ENV = oldEnv;
      if (oldKey !== undefined) process.env.ENCRYPTION_KEY = oldKey;
    }
  });
});

describe('CSD activation (zero-downtime renewal)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  function futureDate(days) { return new Date(Date.now() + days * 86400000); }

  test('activates a valid cert and deactivates siblings in one transaction', async () => {
    const conn = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
    db.getConnection.mockResolvedValue(conn);
    db.query.mockImplementation(async (sql) => {
      if (/FROM organizations/.test(sql)) return [[{ locale: 'MX' }]];
      if (/FROM csd_certificates WHERE id/.test(sql)) return [[{ id: 9, status: 'active', valid_to: futureDate(300) }]];
      return [[]];
    });
    const res = await request(app)
      .post('/api/v1/csd-certificates/9/activate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(conn.execute.mock.calls[0][0]).toContain('is_active = 0');
    expect(conn.execute.mock.calls[1][0]).toContain('is_active = 1');
    expect(conn.commit).toHaveBeenCalled();
  });

  test('422 CSD_NOT_ACTIVATABLE for an expired certificate', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM organizations/.test(sql)) return [[{ locale: 'MX' }]];
      if (/FROM csd_certificates WHERE id/.test(sql)) return [[{ id: 9, status: 'active', valid_to: new Date('2020-01-01') }]];
      return [[]];
    });
    const res = await request(app)
      .post('/api/v1/csd-certificates/9/activate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CSD_NOT_ACTIVATABLE');
  });
});
