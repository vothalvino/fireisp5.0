jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(),
  close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));
jest.mock('net-snmp', () => ({}), { virtual: true });

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret, { expiresIn: '1h' },
  );
}

const sampleRule = {
  id: 1, organization_id: 10, name: 'No Telnet', description: null,
  rule_type: 'must_not_contain', pattern: 'telnet', severity: 'critical',
  applies_to_device_type: null, is_enabled: 1, deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup (backtick-quoted table name)
    if (typeof sql === 'string' && sql.includes('users') && sql.includes('WHERE id = ?') && !sql.includes('config_compliance') && !sql.includes('device')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'config_compliance.view' }, { id: 2, name: 'config_compliance.create' },
        { id: 3, name: 'config_compliance.update' }, { id: 4, name: 'config_compliance.delete' },
        { id: 5, name: 'config_compliance.run' },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO config_compliance_rules')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('SELECT * FROM config_compliance_rules WHERE id = ?')) {
      return Promise.resolve([[sampleRule]]);
    }
    // compliance audit queries
    if (typeof sql === 'string' && sql.includes('FROM device_config_backups WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, device_id: 10, content: 'ip route add default' }]]);
    }
    if (typeof sql === 'string' && sql.includes('FROM devices WHERE id = ?')) {
      return Promise.resolve([[{ id: 10, device_type: 'router' }]]);
    }
    if (typeof sql === 'string' && sql.includes('FROM config_compliance_rules')) {
      return Promise.resolve([[sampleRule]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO config_compliance_results')) {
      return Promise.resolve([{ insertId: 50 }]);
    }
    return Promise.resolve([[sampleRule]]);
  });
}

describe('Config Compliance Rule routes', () => {
  const token = adminToken();
  beforeEach(() => { jest.clearAllMocks(); mockDbDefault(); });

  test('GET /api/v1/config-compliance-rules returns list', async () => {
    const res = await request(app)
      .get('/api/v1/config-compliance-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .expect(200);
    expect(res.body.data).toBeDefined();
  });

  test('POST /api/v1/config-compliance-rules creates rule', async () => {
    const res = await request(app)
      .post('/api/v1/config-compliance-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'No Telnet', rule_type: 'must_not_contain', pattern: 'telnet' })
      .expect(201);
    expect(res.body.data).toBeDefined();
  });

  test('GET /api/v1/config-compliance-rules/results returns results', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('users') && sql.includes('WHERE id = ?') && !sql.includes('config_compliance') && !sql.includes('device')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'config_compliance.view' }]]);
      }
      if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
        return Promise.resolve([[{ total: 0 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/config-compliance-rules/results')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .expect(200);
    expect(res.body.data).toBeDefined();
  });

  test('POST /api/v1/config-compliance-rules/run runs audit', async () => {
    const res = await request(app)
      .post('/api/v1/config-compliance-rules/run')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ backup_id: 1 })
      .expect(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data).toHaveProperty('total');
  });
});
