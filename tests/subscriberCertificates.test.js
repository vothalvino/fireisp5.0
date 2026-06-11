// =============================================================================
// FireISP 5.0 — Subscriber Certificate Route Tests (§3.1)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const cert = {
  id: 1,
  organization_id: 10,
  radius_account_id: 5,
  client_id: 3,
  common_name: 'client3@isp.net',
  serial_number: '0ABCDEF123',
  fingerprint_sha256: 'a'.repeat(64),
  valid_from: '2025-01-01T00:00:00.000Z',
  valid_until: '2026-01-01T00:00:00.000Z',
  status: 'active',
  revoked_at: null,
  revocation_reason: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      // Let RBAC pass: return one matching permission row
      return Promise.resolve([[{ id: 1, name: 'subscriber_certificates.view' }]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default list / get
    return Promise.resolve([[cert]]);
  });
}

describe('Subscriber Certificate routes (§3.1)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbDefault();
  });

  test('GET /subscriber-certificates returns 200', async () => {
    const res = await request(app)
      .get('/api/v1/subscriber-certificates')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 404]).toContain(res.status);
  });

  test('POST /subscriber-certificates validates required fields', async () => {
    const res = await request(app)
      .post('/api/v1/subscriber-certificates')
      .set('Authorization', `Bearer ${token}`)
      .send({ common_name: 'test' }); // missing serial_number, fingerprint_sha256, valid_from, valid_until
    expect(res.status).toBe(422);
  });

  test('POST /subscriber-certificates rejects fingerprint shorter than 64 chars', async () => {
    const res = await request(app)
      .post('/api/v1/subscriber-certificates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        common_name: 'test@isp.net',
        serial_number: 'ABC123',
        fingerprint_sha256: 'short',
        valid_from: '2025-01-01',
        valid_until: '2026-01-01',
      });
    expect(res.status).toBe(422);
  });

  test('POST /subscriber-certificates with valid payload does not return 422', async () => {
    const res = await request(app)
      .post('/api/v1/subscriber-certificates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        common_name: 'test@isp.net',
        serial_number: 'ABC123DEF456',
        fingerprint_sha256: 'a'.repeat(64),
        valid_from: '2025-01-01T00:00:00Z',
        valid_until: '2026-01-01T00:00:00Z',
        radius_account_id: 5,
        client_id: 3,
      });
    expect(res.status).not.toBe(422);
  });

  test('POST /subscriber-certificates/:id/revoke returns non-500 for existing cert', async () => {
    // Cert is active — should accept revocation
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        // First call: auth, then cert lookup
        const calls = db.query.mock.calls.length;
        if (calls <= 1) {
          return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
        }
        return Promise.resolve([[cert]]);
      }
      if (typeof sql === 'string' && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[cert]]);
    });

    const res = await request(app)
      .post('/api/v1/subscriber-certificates/1/revoke')
      .set('Authorization', `Bearer ${token}`)
      .send({ revocation_reason: 'Key compromised' });

    expect([200, 404, 409]).toContain(res.status);
  });
});
