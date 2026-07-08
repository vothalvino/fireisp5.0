// =============================================================================
// FireISP 5.0 — Section 17 Route Tests (Security & Access Control)
// Covers: /security-admin, /network-security, /data-security, /webhook-security
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
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

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req, _res, next) => {
    _req.user = { id: 1, email: 'test@test.com', role: 'admin', organizationId: 1 };
    next();
  },
  optionalAuth: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (_req, _res, next) => { _req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/rateLimit', () => ({
  apiLimiter: (_req, _res, next) => next(),
  sessionLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
  publicLimiter: (_req, _res, next) => next(),
  uploadLimiter: (_req, _res, next) => next(),
  exportLimiter: (_req, _res, next) => next(),
  sseLimiter: (_req, _res, next) => next(),
  webhookLimiter: (_req, _res, next) => next(),
  tenantApiLimiter: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/featureFlag', () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));

// Raise rate limits well above the test request count so no 429s during testing
process.env.RATE_LIMIT_API = '9999';
process.env.RATE_LIMIT_TENANT_API = '9999';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

/** Standard db mock: auth user lookup + audit log insert + fallback. */
function mockDbBase() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webauthn') && !sql.includes('firewall') && !sql.includes('ddos') && !sql.includes('blackhole') && !sql.includes('dns_blocklists') && !sql.includes('cpe_security') && !sql.includes('encryption_key') && !sql.includes('data_masking') && !sql.includes('secure_deletion') && !sql.includes('admin_ip') && !sql.includes('password_policies') && !sql.includes('api_key_rate')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    return Promise.resolve([[]]);
  });
}

// =============================================================================
// /security-admin/webauthn
// =============================================================================

describe('GET /api/v1/security-admin/webauthn', () => {
  beforeEach(() => {
    mockDbBase();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webauthn')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('webauthn_credentials')) {
        return Promise.resolve([[{ id: 1, user_id: 1, credential_id: 'cred123', friendly_name: 'YubiKey' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with webauthn credential list', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/v1/security-admin/webauthn', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webauthn')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO webauthn_credentials')) {
        return Promise.resolve([{ insertId: 5, affectedRows: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on webauthn credential create', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ credential_id: 'cred-abc', public_key: 'pubkey-xyz', friendly_name: 'YubiKey 5' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when credential_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ public_key: 'pubkey-xyz' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when public_key is missing', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ credential_id: 'cred-abc' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/security-admin/webauthn/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webauthn')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('UPDATE webauthn_credentials SET deleted_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on successful revoke', async () => {
    const res = await request(app)
      .delete('/api/v1/security-admin/webauthn/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when credential not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webauthn')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .delete('/api/v1/security-admin/webauthn/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// /security-admin/password-policy
// =============================================================================

describe('GET /api/v1/security-admin/password-policy', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('password_policies')) {
        return Promise.resolve([[{ id: 1, organization_id: 1, min_length: 12, require_uppercase: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with password policy', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 404 when no policy configured', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]); // empty result for password_policies
    });
    const res = await request(app)
      .get('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/security-admin/password-policy', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('password_policies')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on successful password policy update', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ min_length: 12, require_uppercase: true, require_digits: true });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 422 when min_length is below 8', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ min_length: 4 });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /security-admin/admin-ip-allowlist
// =============================================================================

describe('GET /api/v1/security-admin/admin-ip-allowlist', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('admin_ip_allowlist')) {
        return Promise.resolve([[{ id: 1, ip_address: '10.0.0.1', description: 'Office' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with admin IP allowlist', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/admin-ip-allowlist')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/security-admin/admin-ip-allowlist', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO admin_ip_allowlist')) {
        return Promise.resolve([{ insertId: 3, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on IP allowlist entry create', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/admin-ip-allowlist')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ ip_address: '192.168.1.100', description: 'VPN gateway' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when ip_address is missing', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/admin-ip-allowlist')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ description: 'Missing IP' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /network-security/firewall-rules
// =============================================================================

describe('GET /api/v1/network-security/firewall-rules', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('firewall_rules')) {
        return Promise.resolve([[{ id: 1, action: 'deny', protocol: 'tcp', priority: 10 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with firewall rules list', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/v1/network-security/firewall-rules', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO firewall_rules')) {
        return Promise.resolve([{ insertId: 7, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on firewall rule create', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ action: 'deny', protocol: 'tcp', priority: 100, dst_port: '22' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when action is missing', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ protocol: 'tcp' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when protocol is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ action: 'deny', protocol: 'ftp' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when action is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ action: 'reject', protocol: 'tcp' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /network-security/ddos-protection activate
// =============================================================================

describe('POST /api/v1/network-security/ddos-protection/:id/activate', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules') && sql.includes('triggered_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DDoS rule activation', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection/1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('activated_at');
  });

  it('returns 404 when DDoS rule not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection/999/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// /network-security/blackhole-routes
// =============================================================================

describe('GET /api/v1/network-security/blackhole-routes', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('blackhole_routes')) {
        return Promise.resolve([[{ id: 1, target_prefix: '192.0.2.0/24', reason: 'spam', is_active: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with blackhole routes list', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/blackhole-routes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/network-security/blackhole-routes', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO blackhole_routes')) {
        return Promise.resolve([{ insertId: 4, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on blackhole route create', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/blackhole-routes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ target_prefix: '198.51.100.0/24', reason: 'DDoS source' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when target_prefix is missing', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/blackhole-routes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ reason: 'no prefix' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/network-security/blackhole-routes/:id/release', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('blackhole_routes') && sql.includes('deactivated_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on blackhole route release', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/blackhole-routes/1/release')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('deactivated_at');
  });
});

describe('DELETE /api/v1/network-security/blackhole-routes/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('blackhole_routes') && sql.includes('DELETE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on blackhole route delete', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/blackhole-routes/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when blackhole route not found for delete', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .delete('/api/v1/network-security/blackhole-routes/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// /network-security/dns-blocklists
// =============================================================================

describe('GET /api/v1/network-security/dns-blocklists', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, domain: 'malware.example.com', category: 'malware' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with DNS blocklist', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/network-security/dns-blocklists', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO dns_blocklists')) {
        return Promise.resolve([{ insertId: 8, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on DNS blocklist entry create', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ domain: 'phishing.example.com', category: 'phishing' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when domain is missing', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ category: 'malware' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when category is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ domain: 'bad.example.com', category: 'not_a_valid_category' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /network-security/cpe-security-scans
// =============================================================================

describe('GET /api/v1/network-security/cpe-security-scans', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('cpe_security')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('cpe_security_scans')) {
        return Promise.resolve([[{ id: 1, scan_type: 'full', status: 'completed' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with CPE security scans list', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/network-security/cpe-security-scans', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('cpe_security')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO cpe_security_scans')) {
        return Promise.resolve([{ insertId: 2, affectedRows: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('cpe_security_scans') && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 2, scan_type: 'full', status: 'pending', device_id: 5 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on CPE scan trigger with device_id', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ scan_type: 'full', device_id: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when neither device_id nor cpe_device_id provided', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ scan_type: 'full' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when scan_type is missing', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ device_id: 5 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when scan_type is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ scan_type: 'unknown_scan', device_id: 5 });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /data-security/encryption-keys
// =============================================================================

describe('GET /api/v1/data-security/encryption-keys', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('encryption')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('encryption_key_metadata')) {
        return Promise.resolve([[{ id: 1, key_alias: 'master-key', algorithm: 'AES-256-GCM', status: 'active' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with encryption key metadata list', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/encryption-keys')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /data-security/secure-deletion
// =============================================================================

describe('POST /api/v1/data-security/secure-deletion', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM')) {
        return Promise.resolve([{ affectedRows: 5 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO secure_deletion_log')) {
        return Promise.resolve([{ insertId: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with deletion stats', async () => {
    const res = await request(app)
      .post('/api/v1/data-security/secure-deletion')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /webhook-security/verify-signature
// =============================================================================

describe('POST /api/v1/webhook-security/verify-signature', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('returns valid=true for correct signature', async () => {
    const crypto = require('crypto');
    const secret = 'test-secret-key';
    // Use a simple string payload to avoid JSON double-encoding issues
    const payload = 'hello-webhook-body';
    const hex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const signature = `sha256=${hex}`;

    // Mock user lookup for authenticate middleware is handled by the mock
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/webhook-security/verify-signature')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ signature, secret, payload });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', true);
  });

  it('returns valid=false for incorrect signature', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/webhook-security/verify-signature')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ signature: 'sha256=deadbeefdeadbeefdeadbeefdeadbeef', secret: 'wrong-secret', payload: '{"event":"test"}' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', false);
  });

  it('returns 422 when required fields are missing', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/webhook-security/verify-signature')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ signature: 'sha256=abc' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /webhook-security/verify-signing
// =============================================================================

describe('GET /api/v1/webhook-security/verify-signing', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with signing documentation', async () => {
    const res = await request(app)
      .get('/api/v1/webhook-security/verify-signing')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('algorithm', 'HMAC-SHA256');
  });
});

// =============================================================================
// /data-security/tls-config
// =============================================================================

describe('GET /api/v1/data-security/tls-config', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with TLS configuration documentation', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/tls-config')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('min_tls_version');
    expect(res.body.data).toHaveProperty('cipher_suites');
  });
});

// =============================================================================
// /security-admin/api-key-rate-limits
// =============================================================================

describe('GET /api/v1/security-admin/api-key-rate-limits', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('api_key_rate_limits')) {
        return Promise.resolve([[{ id: 1, token_id: 5, requests_per_minute: 60 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with api key rate limit list', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/api-key-rate-limits')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/security-admin/api-key-rate-limits/:tokenId', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('api_key_rate_limits')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on rate limit upsert', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/api-key-rate-limits/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ requests_per_minute: 60, requests_per_hour: 1000 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('PUT /api/v1/security-admin/admin-ip-allowlist/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('admin_ip')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('admin_ip_allowlist') && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on admin IP allowlist update', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/admin-ip-allowlist/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ ip_address: '10.1.1.1', description: 'Updated VPN' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when admin IP allowlist entry not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('admin_ip')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .put('/api/v1/security-admin/admin-ip-allowlist/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ ip_address: '10.1.1.1' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/security-admin/admin-ip-allowlist/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('admin_ip')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('admin_ip_allowlist') && sql.includes('DELETE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on admin IP allowlist delete', async () => {
    const res = await request(app)
      .delete('/api/v1/security-admin/admin-ip-allowlist/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /network-security additional CRUD
// =============================================================================

describe('PUT /api/v1/network-security/firewall-rules/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('firewall_rules') && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on firewall rule update', async () => {
    const res = await request(app)
      .put('/api/v1/network-security/firewall-rules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ priority: 50, is_active: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when firewall rule not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .put('/api/v1/network-security/firewall-rules/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ is_active: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/network-security/firewall-rules/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('firewall_rules') && sql.includes('deleted_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on firewall rule delete (soft)', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/firewall-rules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/network-security/ddos-protection', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules')) {
        return Promise.resolve([[{ id: 1, rule_type: 'rtbh', target_prefix: '198.51.100.0/24', is_active: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with DDoS protection rules list', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/ddos-protection')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/network-security/ddos-protection/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules') && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DDoS rule update', async () => {
    const res = await request(app)
      .put('/api/v1/network-security/ddos-protection/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ threshold_pps: 100000 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('DELETE /api/v1/network-security/ddos-protection/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules') && sql.includes('DELETE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DDoS rule delete', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/ddos-protection/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('POST /api/v1/network-security/ddos-protection/:id/deactivate', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules') && sql.includes('deactivated_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DDoS rule deactivation', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection/1/deactivate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('deactivated_at');
  });

  it('returns 404 when DDoS rule not found for deactivation', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection/999/deactivate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/network-security/dns-blocklists/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('dns_blocklists') && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DNS blocklist update', async () => {
    const res = await request(app)
      .put('/api/v1/network-security/dns-blocklists/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when DNS blocklist entry not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .put('/api/v1/network-security/dns-blocklists/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ is_active: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/network-security/dns-blocklists/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('dns_blocklists') && sql.includes('DELETE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DNS blocklist delete', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/dns-blocklists/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 404 when DNS blocklist entry not found for delete', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dns_blocklists')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    const res = await request(app)
      .delete('/api/v1/network-security/dns-blocklists/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/network-security/cpe-security-scans/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('cpe_security')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('cpe_security_scans') && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, scan_type: 'full', status: 'completed', default_password_found: 1 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with CPE scan details', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/cpe-security-scans/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 404 when CPE scan not found', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('cpe_security')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]); // empty result for cpe_security_scans
    });
    const res = await request(app)
      .get('/api/v1/network-security/cpe-security-scans/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// /data-security additional endpoints
// =============================================================================

describe('POST /api/v1/data-security/encryption-keys', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('encryption')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO encryption_key_metadata')) {
        return Promise.resolve([{ insertId: 2, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on encryption key metadata create', async () => {
    const res = await request(app)
      .post('/api/v1/data-security/encryption-keys')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ key_alias: 'primary-key', algorithm: 'AES-256-GCM', purpose: 'pii', status: 'active' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('PUT /api/v1/data-security/encryption-keys/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('encryption')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('encryption_key_metadata') && sql.includes('UPDATE')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on encryption key update', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/encryption-keys/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ status: 'archived', notes: 'Rotated to new key' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns 200 on encryption key rotate action', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/encryption-keys/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ action: 'rotate' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/data-security/data-masking', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('data_masking')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('data_masking_rules')) {
        return Promise.resolve([[{ id: 1, table_name: 'clients', column_name: 'phone', masking_type: 'partial' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with data masking rules', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/data-masking')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/data-security/data-masking', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('data_masking')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('data_masking_rules')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on data masking rule upsert', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/data-masking')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ table_name: 'clients', column_name: 'phone', masking_type: 'partial' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/data-security/secure-deletion-log', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('secure_deletion')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('secure_deletion_log')) {
        return Promise.resolve([[{ id: 1, table_name: 'dsar_requests', record_count: 5, deleted_at: new Date() }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with secure deletion log', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/secure-deletion-log')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/webhook-security/delivery-logs', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('webhook_deliveries')) {
        return Promise.resolve([[{ id: 1, event_name: 'invoice.created', status: 'success' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with webhook delivery logs', async () => {
    const res = await request(app)
      .get('/api/v1/webhook-security/delivery-logs')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// Error path tests (database failure → 500)
// Auth middleware is fully mocked so db.query is never called for auth.
// We can safely reject ALL db.query calls to trigger catch(err) → next(err).
// =============================================================================

describe('Error paths — networkSecurity catch blocks', () => {
  beforeEach(() => { db.query.mockRejectedValue(new Error('DB connection failed')); });
  afterEach(() => { jest.clearAllMocks(); });

  it('GET /firewall-rules returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /firewall-rules returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/firewall-rules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ action: 'deny', protocol: 'tcp' });
    expect(res.status).toBe(500);
  });

  it('GET /ddos-protection returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/ddos-protection')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /ddos-protection returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ rule_type: 'flowspec', target_prefix: '10.0.0.0/8', action: 'drop' });
    expect(res.status).toBe(500);
  });

  it('GET /blackhole-routes returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/blackhole-routes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /blackhole-routes returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/blackhole-routes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ target_prefix: '192.168.1.0/24', reason: 'abuse' });
    expect(res.status).toBe(500);
  });

  it('GET /dns-blocklists returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /dns-blocklists returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/dns-blocklists')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ domain: 'malware.example.com', category: 'malware' });
    expect(res.status).toBe(500);
  });

  it('GET /cpe-security-scans returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/network-security/cpe-security-scans')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });
});

describe('dataSecurity — PUT /encryption-keys/:id with no updatable fields (updates.length === 1)', () => {
  beforeEach(() => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('sends only updated_at when body has no recognized fields', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/encryption-keys/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Error paths — dataSecurity catch blocks', () => {
  beforeEach(() => { db.query.mockRejectedValue(new Error('DB connection failed')); });
  afterEach(() => { jest.clearAllMocks(); });

  it('GET /encryption-keys returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/encryption-keys')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /encryption-keys returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/data-security/encryption-keys')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ key_alias: 'test-key', algorithm: 'AES-256-GCM' });
    expect(res.status).toBe(500);
  });

  it('PUT /encryption-keys/:id returns 500 on db error', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/encryption-keys/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ key_alias: 'new-alias' });
    expect(res.status).toBe(500);
  });

  it('GET /data-masking returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/data-masking')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('PUT /data-masking returns 500 on db error', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/data-masking')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ table_name: 'clients', column_name: 'phone', masking_type: 'partial' });
    expect(res.status).toBe(500);
  });

  it('GET /secure-deletion-log returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/data-security/secure-deletion-log')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });
});

describe('Error paths — securityAdmin catch blocks', () => {
  beforeEach(() => { db.query.mockRejectedValue(new Error('DB connection failed')); });
  afterEach(() => { jest.clearAllMocks(); });

  it('GET /webauthn returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /webauthn returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/webauthn')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ credential_id: 'cred123', public_key: 'pubkey456' });
    expect(res.status).toBe(500);
  });

  it('GET /admin-ip-allowlist returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/admin-ip-allowlist')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('POST /admin-ip-allowlist returns 500 on db error', async () => {
    const res = await request(app)
      .post('/api/v1/security-admin/admin-ip-allowlist')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ ip_address: '10.0.0.1' });
    expect(res.status).toBe(500);
  });

  it('GET /api-key-rate-limits returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/api-key-rate-limits')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('PUT /api-key-rate-limits/:tokenId returns 500 on db error', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/api-key-rate-limits/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ requests_per_minute: 100 });
    expect(res.status).toBe(500);
  });

  it('GET /password-policy returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });

  it('PUT /password-policy returns 500 on db error', async () => {
    const res = await request(app)
      .put('/api/v1/security-admin/password-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ min_length: 12 });
    expect(res.status).toBe(500);
  });
});

describe('Error paths — webhookSecurity catch blocks', () => {
  beforeEach(() => { db.query.mockRejectedValue(new Error('DB connection failed')); });
  afterEach(() => { jest.clearAllMocks(); });

  it('GET /delivery-logs returns 500 on db error', async () => {
    const res = await request(app)
      .get('/api/v1/webhook-security/delivery-logs')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// /network-security/ddos-protection (create + deactivate)
// =============================================================================

describe('POST /api/v1/network-security/ddos-protection', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO ddos_protection_rules')) {
        return Promise.resolve([{ insertId: 3, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on DDoS rule create', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ rule_type: 'rtbh', target_prefix: '203.0.113.0/24', action: 'drop' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('returns 422 when rule_type is missing', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ target_prefix: '203.0.113.0/24', action: 'drop' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// Additional 404 edge-case tests to improve coverage
// =============================================================================

describe('PUT /api/v1/data-security/encryption-keys/:id 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('encryption')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when encryption key not found', async () => {
    const res = await request(app)
      .put('/api/v1/data-security/encryption-keys/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ status: 'archived' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/network-security/blackhole-routes/:id/release 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('blackhole')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when blackhole route not found for release', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/blackhole-routes/999/release')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/network-security/ddos-protection/:id 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when DDoS rule not found for update', async () => {
    const res = await request(app)
      .put('/api/v1/network-security/ddos-protection/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ threshold_pps: 500000 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/network-security/ddos-protection/:id 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when DDoS rule not found for delete', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/ddos-protection/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/network-security/firewall-rules/:id 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('firewall')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when firewall rule not found for delete', async () => {
    const res = await request(app)
      .delete('/api/v1/network-security/firewall-rules/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/security-admin/admin-ip-allowlist/:id 404', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('admin_ip')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when admin IP allowlist entry not found for delete', async () => {
    const res = await request(app)
      .delete('/api/v1/security-admin/admin-ip-allowlist/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/webhook-security/verify-signature (no sha256 prefix)', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('returns valid=true when signature is provided without sha256= prefix', async () => {
    const crypto = require('crypto');
    const secret = 'mysecret';
    const payload = 'testpayload';
    const hex = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/webhook-security/verify-signature')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1')
      .send({ signature: hex, secret, payload });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', true);
  });
});

describe('POST /api/v1/network-security/ddos-protection/:id/deactivate', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('ddos')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('ddos_protection_rules') && sql.includes('deactivated_at')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on DDoS rule deactivation', async () => {
    const res = await request(app)
      .post('/api/v1/network-security/ddos-protection/1/deactivate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('deactivated_at');
  });
});

// =============================================================================
// /security-admin/api-key-rate-limits
// =============================================================================

describe('GET /api/v1/security-admin/api-key-rate-limits', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('api_key_rate')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('api_key_rate_limits')) {
        return Promise.resolve([[{ id: 1, token_id: 10, requests_per_minute: 60 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with API key rate limits list', async () => {
    const res = await request(app)
      .get('/api/v1/security-admin/api-key-rate-limits')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /webhook-security/delivery-logs
// =============================================================================

describe('GET /api/v1/webhook-security/delivery-logs', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('webhook_deliveries')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('webhook_deliveries')) {
        return Promise.resolve([[{ id: 1, event: 'payment.created', status: 'delivered' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with webhook delivery logs', async () => {
    const res = await request(app)
      .get('/api/v1/webhook-security/delivery-logs')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});
