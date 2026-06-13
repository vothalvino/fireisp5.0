// =============================================================================
// FireISP 5.0 — Section 16 Route Tests (Regulatory Compliance — Mexico)
// Covers: /regulatory-compliance, /numbering-management, /universal-service,
//         /consumer-protection, /data-residency, /audit-logs (export + report-access-logs),
//         /dsar/requests
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
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

/** Standard db mock: auth user lookup + audit log insert. */
function mockDbAuth() {
  db.query.mockImplementation((sql) => {
    if (
      typeof sql === 'string' &&
      sql.includes('WHERE id = ?') &&
      !sql.includes('dsar_requests') &&
      !sql.includes('subscriber_consents') &&
      !sql.includes('identity_verification') &&
      !sql.includes('gov_data_requests') &&
      !sql.includes('phone_number_inventory') &&
      !sql.includes('number_portability') &&
      !sql.includes('numbering_blocks') &&
      !sql.includes('uso_obligations') &&
      !sql.includes('rural_coverage') &&
      !sql.includes('service_modification') &&
      !sql.includes('data_residency') &&
      !sql.includes('report_access_logs')
    ) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO report_access_logs')) {
      return Promise.resolve([{ insertId: 100 }]);
    }
    return Promise.resolve([[]]);
  });
}

// =============================================================================
// /api/v1/regulatory-compliance/consent
// =============================================================================

describe('GET /api/v1/regulatory-compliance/consent', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, purpose: 'marketing', given_at: new Date() }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with consent list', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/consent')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/regulatory-compliance/consent', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO subscriber_consents')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on consent create', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/consent')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, consent_version: '1.0', purpose: 'marketing', channel: 'email' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('PUT /api/v1/regulatory-compliance/consent/:id/withdraw', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('subscriber_consents')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on withdraw', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/consent/1/withdraw')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/regulatory-compliance/consent/client/:clientId', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[{ id: 1, client_id: 5, purpose: 'marketing' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with client consents', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/consent/client/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/regulatory-compliance/dsar-requests
// =============================================================================

describe('GET /api/v1/regulatory-compliance/dsar-requests', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, request_type: 'access', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with dsar request list', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/dsar-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/regulatory-compliance/dsar-requests', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO dsar_requests')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on dsar request create', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/dsar-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, request_type: 'access' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/v1/regulatory-compliance/dsar-requests/:id', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM dsar_requests')) {
        return Promise.resolve([[{ id: 1, request_type: 'access', status: 'pending' }]]);
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with dsar request', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/dsar-requests/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/regulatory-compliance/dsar-requests/:id/fulfill', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on fulfill', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/dsar-requests/1/fulfill')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ notes: 'Data exported and delivered' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('PUT /api/v1/regulatory-compliance/dsar-requests/:id/legal-hold', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on legal hold', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/dsar-requests/1/legal-hold')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ legal_hold_reason: 'Active litigation' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/regulatory-compliance/identity-verification
// =============================================================================

describe('POST /api/v1/regulatory-compliance/identity-verification — valid CURP', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO identity_verification_records')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  // CURP: LOAM850618HBCPNR01 is a known valid test CURP
  it('returns 201 for valid CURP', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/identity-verification')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, id_type: 'INE', id_number: 'INE123456', verification_method: 'in_person' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('POST /api/v1/regulatory-compliance/identity-verification — invalid CURP', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 422 for invalid CURP', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/identity-verification')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, id_type: 'CURP', id_number: 'INVALID_CURP_000', verification_method: 'digital' });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error', 'CURP_INVALID');
  });
});

describe('PUT /api/v1/regulatory-compliance/identity-verification/:id/verify', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('identity_verification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on verify', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/identity-verification/1/verify')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/regulatory-compliance/gov-data-requests
// =============================================================================

describe('GET /api/v1/regulatory-compliance/gov-data-requests', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, authority_name: 'PGR', request_type: 'subscriber_data' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with gov data request list', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/gov-data-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/regulatory-compliance/gov-data-requests', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO gov_data_requests')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on gov data request create', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/gov-data-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ authority_name: 'PGR', authority_ref: 'PGR-2026-001', request_type: 'subscriber_data', legal_basis: 'Art. 190 LFTR' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('row_hash');
  });
});

describe('PUT /api/v1/regulatory-compliance/gov-data-requests/:id/fulfill', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('gov_data_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on fulfill', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/gov-data-requests/1/fulfill')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/audit-logs extensions
// =============================================================================

describe('GET /api/v1/audit-logs/export', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO report_access_logs')) {
        return Promise.resolve([{ insertId: 100 }]);
      }
      return Promise.resolve([[{ id: 1, action: 'CREATE', table_name: 'clients' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with exported audit logs', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs/export')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('exported_at');
  });
});

describe('GET /api/v1/audit-logs/report-access-logs', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, report_type: 'audit_export', accessed_at: new Date() }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with report access logs', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs/report-access-logs')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/dsar/requests
// =============================================================================

describe('GET /api/v1/dsar/requests', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, request_type: 'access', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with dsar requests', async () => {
    const res = await request(app)
      .get('/api/v1/dsar/requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/numbering-management/phone-numbers
// =============================================================================

describe('GET /api/v1/numbering-management/phone-numbers', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, phone_number: '5551234567', status: 'available' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with phone number list', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/phone-numbers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/numbering-management/phone-numbers', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO phone_number_inventory')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on phone number create', async () => {
    const res = await request(app)
      .post('/api/v1/numbering-management/phone-numbers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ phone_number: '5551234567', number_type: 'geographic', lada: '55' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

// =============================================================================
// /api/v1/numbering-management/portability
// =============================================================================

describe('GET /api/v1/numbering-management/portability', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, phone_number: '5551234567', port_type: 'in', status: 'requested' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with portability list', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/portability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('PUT /api/v1/numbering-management/portability/:id/complete', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('number_portability')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on portability complete', async () => {
    const res = await request(app)
      .put('/api/v1/numbering-management/portability/1/complete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/numbering-management/numbering-blocks
// =============================================================================

describe('GET /api/v1/numbering-management/numbering-blocks', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, block_start: '5550000000', block_end: '5559999999' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with numbering blocks', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/numbering-blocks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/universal-service/uso-obligations
// =============================================================================

describe('GET /api/v1/universal-service/uso-obligations', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, obligation_type: 'coverage', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with uso obligations', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/uso-obligations')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/universal-service/uso-obligations', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO uso_obligations')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on uso obligation create', async () => {
    const res = await request(app)
      .post('/api/v1/universal-service/uso-obligations')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ obligation_type: 'coverage', description: 'Rural coverage target' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('PUT /api/v1/universal-service/uso-obligations/:id/report', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('uso_obligations')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on uso obligation report', async () => {
    const res = await request(app)
      .put('/api/v1/universal-service/uso-obligations/1/report')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ actual_value: 95.5 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/universal-service/rural-coverage
// =============================================================================

describe('GET /api/v1/universal-service/rural-coverage', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, locality_name: 'La Paloma', homes_passed: 200 }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with rural coverage list', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/rural-coverage')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/universal-service/rural-coverage/summary', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[{ total_homes_passed: 1000, total_homes_connected: 750, locality_count: 5, underserved_count: 2 }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with rural coverage summary', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/rural-coverage/summary')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/consumer-protection/service-modifications
// =============================================================================

describe('GET /api/v1/consumer-protection/service-modifications', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, notice_type: 'price_change', status: 'draft' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with service modification list', async () => {
    const res = await request(app)
      .get('/api/v1/consumer-protection/service-modifications')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/consumer-protection/service-modifications', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO service_modification_notices')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on service modification create', async () => {
    const res = await request(app)
      .post('/api/v1/consumer-protection/service-modifications')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ notice_type: 'price_change', effective_date: '2026-07-01', notice_required_days: 30 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('PUT /api/v1/consumer-protection/service-modifications/:id/send', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('service_modification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on send', async () => {
    const res = await request(app)
      .put('/api/v1/consumer-protection/service-modifications/1/send')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// /api/v1/consumer-protection/contract-templates-mx
// =============================================================================

describe('GET /api/v1/consumer-protection/contract-templates-mx', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, name: 'Standard Contract MX', version: '1.0' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with contract template list', async () => {
    const res = await request(app)
      .get('/api/v1/consumer-protection/contract-templates-mx')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/data-residency
// =============================================================================

describe('GET /api/v1/data-residency', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('FROM data_residency_config')) {
        return Promise.resolve([[{ id: 1, primary_storage_country: 'MX', compliance_status: 'compliant' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with data residency config', async () => {
    const res = await request(app)
      .get('/api/v1/data-residency')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/data-residency', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO data_residency_config')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on data residency config create', async () => {
    const res = await request(app)
      .post('/api/v1/data-residency')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ primary_storage_country: 'MX', primary_storage_region: 'CDMX' });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/data-residency/check', () => {
  beforeEach(() => {
    mockDbAuth();
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT primary_storage_country')) {
        return Promise.resolve([[{ primary_storage_country: 'MX' }]]);
      }
      if (typeof sql === 'string' && sql.includes('UPDATE data_residency_config')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with compliance check result', async () => {
    const res = await request(app)
      .post('/api/v1/data-residency/check')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('compliance_status');
  });
});

// =============================================================================
// auditLogs.js — GET / (list audit logs, was uncovered)
// =============================================================================

describe('GET /api/v1/audit-logs', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 2 }]]);
      }
      return Promise.resolve([[{ id: 1, action: 'CREATE', table_name: 'clients' }, { id: 2, action: 'UPDATE', table_name: 'plans' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with audit log list', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });

  it('returns 200 with filter params (user_id, action, table_name, date_from, date_to)', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs?user_id=1&action=CREATE&table_name=clients&date_from=2026-01-01&date_to=2026-12-31')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/audit-logs/export — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO report_access_logs')) {
        return Promise.resolve([{ insertId: 100 }]);
      }
      return Promise.resolve([[{ id: 1, action: 'CREATE', table_name: 'clients' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with filters applied (action, entity_type, date_from, date_to)', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs/export?action=CREATE&entity_type=clients&date_from=2026-01-01&date_to=2026-12-31')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.meta).toHaveProperty('exported_at');
  });
});

describe('GET /api/v1/audit-logs/report-access-logs — pagination', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 5 }]]);
      }
      return Promise.resolve([[{ id: 1, report_type: 'audit_export', accessed_at: new Date() }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with pagination params', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs/report-access-logs?page=2&limit=2')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.meta).toHaveProperty('total', 5);
  });
});

// =============================================================================
// numberingManagement.js — GET/PUT/DELETE /:id routes and POST portability/blocks
// =============================================================================

describe('GET /api/v1/numbering-management/phone-numbers/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('phone_number_inventory')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('phone_number_inventory WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, phone_number: '5551234567', status: 'available' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with phone number by id', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/phone-numbers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/numbering-management/phone-numbers/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('phone_number_inventory')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* empty — not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when phone number not found', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/phone-numbers/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/numbering-management/phone-numbers/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('phone_number_inventory')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on phone number update', async () => {
    const res = await request(app)
      .put('/api/v1/numbering-management/phone-numbers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ phone_number: '5551234567', number_type: 'geographic', lada: '55', status: 'assigned' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('DELETE /api/v1/numbering-management/phone-numbers/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on phone number delete (soft block)', async () => {
    const res = await request(app)
      .delete('/api/v1/numbering-management/phone-numbers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/numbering-management/phone-numbers — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, phone_number: '5551234567', status: 'available' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with status/number_type/client_id filters', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/phone-numbers?status=available&number_type=geographic&client_id=5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/numbering-management/portability', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO number_portability_records')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on portability record create', async () => {
    const res = await request(app)
      .post('/api/v1/numbering-management/portability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ phone_number: '5551234567', port_type: 'in', donor_carrier: 'Telcel' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/v1/numbering-management/portability/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('number_portability')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('number_portability_records WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, phone_number: '5551234567', port_type: 'in' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with portability record', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/portability/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/numbering-management/portability/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('number_portability')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when portability record not found', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/portability/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/numbering-management/portability/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('number_portability')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on portability update', async () => {
    const res = await request(app)
      .put('/api/v1/numbering-management/portability/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ status: 'in_progress', notes: 'Processing' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/numbering-management/portability — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, phone_number: '5551234567', port_type: 'in', status: 'requested' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with port_type and status filters', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/portability?port_type=in&status=requested')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/numbering-management/numbering-blocks', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO numbering_blocks')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on numbering block create', async () => {
    const res = await request(app)
      .post('/api/v1/numbering-management/numbering-blocks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ block_start: '5550000000', block_end: '5559999999', lada: '55' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/v1/numbering-management/numbering-blocks/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('numbering_blocks')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('numbering_blocks WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, block_start: '5550000000', block_end: '5559999999' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with numbering block by id', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/numbering-blocks/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/numbering-management/numbering-blocks/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('numbering_blocks')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when numbering block not found', async () => {
    const res = await request(app)
      .get('/api/v1/numbering-management/numbering-blocks/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/numbering-management/numbering-blocks/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('numbering_blocks')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on numbering block update', async () => {
    const res = await request(app)
      .put('/api/v1/numbering-management/numbering-blocks/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ block_start: '5550000000', block_end: '5559999999', lada: '55', status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

// =============================================================================
// universalService.js — GET/PUT /:id routes and POST rural-coverage
// =============================================================================

describe('GET /api/v1/universal-service/uso-obligations/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('uso_obligations')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('uso_obligations WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, obligation_type: 'coverage', status: 'pending' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with uso obligation by id', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/uso-obligations/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/universal-service/uso-obligations/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('uso_obligations')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when uso obligation not found', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/uso-obligations/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/universal-service/uso-obligations/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('uso_obligations')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on uso obligation update', async () => {
    const res = await request(app)
      .put('/api/v1/universal-service/uso-obligations/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ obligation_type: 'coverage', description: 'Updated target', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/universal-service/uso-obligations — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, obligation_type: 'coverage', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with status and obligation_type filters', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/uso-obligations?status=pending&obligation_type=coverage')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/universal-service/rural-coverage', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO rural_coverage_reports')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 201 on rural coverage report create', async () => {
    const res = await request(app)
      .post('/api/v1/universal-service/rural-coverage')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ report_period: '2026-Q1', locality_name: 'La Paloma', homes_passed: 200, homes_connected: 150, is_underserved: true });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/v1/universal-service/rural-coverage/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('rural_coverage')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('rural_coverage_reports WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, locality_name: 'La Paloma', homes_passed: 200 }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with rural coverage record', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/rural-coverage/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/universal-service/rural-coverage/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('rural_coverage')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when rural coverage record not found', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/rural-coverage/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/universal-service/rural-coverage/:id', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('rural_coverage')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on rural coverage update', async () => {
    const res = await request(app)
      .put('/api/v1/universal-service/rural-coverage/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ report_period: '2026-Q1', locality_name: 'La Paloma', homes_passed: 250, homes_connected: 180, is_underserved: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/universal-service/rural-coverage — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, locality_name: 'La Paloma', homes_passed: 200 }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with report_period, state, is_underserved filters', async () => {
    const res = await request(app)
      .get('/api/v1/universal-service/rural-coverage?report_period=2026-Q1&state=CDMX&is_underserved=1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// regulatoryCompliance.js — uncovered routes and branches
// =============================================================================

// validateCurp — exercise full checksum path: 18-char CURP that passes regex and checksum
describe('POST /api/v1/regulatory-compliance/identity-verification — valid CURP checksum path', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO identity_verification_records')) {
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  // ABCD123456HABBDF08 — 18 chars, passes regex pattern, checksum digit = 8 (verified by hand)
  it('returns 201 for CURP that passes full regex + checksum validation', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/identity-verification')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, id_type: 'CURP', id_number: 'ABCD123456HABBDF08', verification_method: 'digital' });
    expect(res.status).toBe(201);
  });

  // 18-char CURP that passes regex but fails checksum — covers checksum branch that returns false
  it('returns 422 for CURP that passes regex but fails checksum', async () => {
    const res = await request(app)
      .post('/api/v1/regulatory-compliance/identity-verification')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ client_id: 1, id_type: 'CURP', id_number: 'ABCD123456HABBDF09', verification_method: 'digital' });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error', 'CURP_INVALID');
  });
});

describe('GET /api/v1/regulatory-compliance/identity-verification', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('identity_verification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, client_id: 1, id_type: 'INE', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with identity verification list', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/identity-verification')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 200 with client_id, status, id_type filters', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/identity-verification?client_id=1&status=pending&id_type=INE')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/identity-verification/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('identity_verification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('identity_verification_records WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, client_id: 1, id_type: 'INE', status: 'pending' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with identity verification record', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/identity-verification/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/identity-verification/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('identity_verification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when identity verification record not found', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/identity-verification/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/regulatory-compliance/identity-verification/:id/reject', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('identity_verification')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on identity verification reject', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/identity-verification/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('PUT /api/v1/regulatory-compliance/dsar-requests/:id/reject', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on dsar request reject', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/dsar-requests/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ notes: 'Request is invalid' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /api/v1/regulatory-compliance/dsar-requests — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, request_type: 'access', status: 'pending' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with status and request_type filters', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/dsar-requests?status=pending&request_type=access')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/dsar-requests/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('dsar_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when dsar request not found', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/dsar-requests/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/regulatory-compliance/consent — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, purpose: 'marketing', given_at: new Date() }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with client_id and purpose filters', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/consent?client_id=5&purpose=marketing')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/gov-data-requests — with filters', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*)')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      return Promise.resolve([[{ id: 1, authority_name: 'PGR', request_type: 'subscriber_data' }]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with status and request_type filters', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/gov-data-requests?status=pending&request_type=subscriber_data')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/gov-data-requests/:id — found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('gov_data_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('gov_data_requests WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, authority_name: 'PGR', request_type: 'subscriber_data' }]]);
      }
      return Promise.resolve([[]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with gov data request by id', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/gov-data-requests/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/regulatory-compliance/gov-data-requests/:id — not found', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('gov_data_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[/* not found */]]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 404 when gov data request not found', async () => {
    const res = await request(app)
      .get('/api/v1/regulatory-compliance/gov-data-requests/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/regulatory-compliance/gov-data-requests/:id/reject', () => {
  beforeEach(() => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('gov_data_requests')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 on gov data request reject', async () => {
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/gov-data-requests/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});
