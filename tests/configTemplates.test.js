jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
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
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const sampleTemplate = {
  id: 1, organization_id: 10, name: 'Base Config', description: null,
  device_type: 'router', manufacturer: 'MikroTik',
  template_content: '/system identity\nset name={{hostname}}',
  variables_schema: null, status: 'active', deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup (backtick-quoted table name)
    if (typeof sql === 'string' && sql.includes('users') && sql.includes('WHERE id = ?') && !sql.includes('config_template')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'config_templates.view' }, { id: 2, name: 'config_templates.create' },
        { id: 3, name: 'config_templates.update' }, { id: 4, name: 'config_templates.delete' },
        { id: 5, name: 'config_deployments.create' },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO config_templates')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE config_templates SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE config_templates')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO config_deployment_records')) {
      return Promise.resolve([{ insertId: 5 }]);
    }
    return Promise.resolve([[sampleTemplate]]);
  });
}

describe('Config Template routes', () => {
  const token = adminToken();
  beforeEach(() => { jest.clearAllMocks(); mockDbDefault(); });

  test('GET /api/v1/config-templates returns list', async () => {
    const res = await request(app)
      .get('/api/v1/config-templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .expect(200);
    expect(res.body.data).toBeDefined();
  });

  test('POST /api/v1/config-templates creates template', async () => {
    const res = await request(app)
      .post('/api/v1/config-templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Base Config', template_content: '/system identity' })
      .expect(201);
    expect(res.body.data).toBeDefined();
  });

  test('PUT /api/v1/config-templates/:id updates template', async () => {
    const res = await request(app)
      .put('/api/v1/config-templates/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Updated Config' })
      .expect(200);
    expect(res.body.data).toBeDefined();
  });

  test('DELETE /api/v1/config-templates/:id soft-deletes template', async () => {
    await request(app)
      .delete('/api/v1/config-templates/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .expect(204);
  });

  test('POST /api/v1/config-templates/:id/deploy creates deployment', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('users') && sql.includes('WHERE id = ?') && !sql.includes('config_template') && !sql.includes('device')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 5, name: 'config_deployments.create' }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM config_templates WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, organization_id: 10, template_content: 'hostname {{hostname}}', status: 'active' }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM devices WHERE id = ?')) {
        return Promise.resolve([[{ id: 5, firerelay_node_id: null }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO config_deployment_records')) {
        return Promise.resolve([{ insertId: 1 }]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[sampleTemplate]]);
    });

    const res = await request(app)
      .post('/api/v1/config-templates/1/deploy')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ device_id: 5, variables: { hostname: 'Router1' } })
      .expect(201);
    expect(res.body.data).toBeDefined();
  });
});
