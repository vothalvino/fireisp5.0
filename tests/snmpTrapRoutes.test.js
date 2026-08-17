'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis(),
}));
jest.mock('net-snmp', () => ({}), { virtual: true });

const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const config = require('../src/config');
const app = require('../src/app');

function token({ sub = 1, role = 'admin' } = {}) {
  return jwt.sign(
    { sub, email: `${role}@test.example`, role, orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const trapRow = {
  id: 701,
  organization_id: 10,
  device_id: 91,
  device_name: 'Tower router',
  source_ip: '10.20.30.40',
  trap_type: 'linkDown',
  trap_oid: '1.3.6.1.6.3.1.1.5.3',
  varbinds: JSON.stringify([{ oid: '1.2.3', value: 'PRIVATE_VARBIND_VALUE' }]),
  community: 'PRIVATE_COMMUNITY',
  snmp_version: 2,
  is_acknowledged: 0,
  acknowledged_by: null,
  acknowledged_by_name: '',
  acknowledged_at: null,
  received_at: '2026-08-17T01:02:03.000Z',
};

function installJwtDb({ role = 'admin', permissions = [] } = {}) {
  db.query.mockImplementation((sql, params = []) => {
    if (/FROM `users` WHERE id = \?/.test(sql)) {
      return Promise.resolve([[
        { id: Number(params[0]), email: `${role}@test.example`, role, status: 'active', organization_id: 10 },
      ]]);
    }
    if (/SELECT g\.id AS group_id/.test(sql)) return Promise.resolve([[]]);
    if (/SELECT DISTINCT p\.name AS slug\s+FROM organization_users/.test(sql)
        || /SELECT DISTINCT p\.name AS slug\s+FROM users u/.test(sql)) {
      return Promise.resolve([permissions.map(slug => ({ slug }))]);
    }
    if (/SELECT COUNT\(\*\) AS total FROM snmp_traps/.test(sql)) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (/FROM snmp_traps t/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
      return Promise.resolve([Number(params[1]) === 10 ? [trapRow] : []]);
    }
    if (/FROM snmp_traps t/.test(sql)) return Promise.resolve([[trapRow]]);
    return Promise.resolve([[]]);
  });
}

describe('SNMP trap payload privacy routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete db.withPrimaryContext;
    installJwtDb();
  });

  afterEach(() => { delete db.withPrimaryContext; });

  test('ordinary devices.view list is metadata-only and never returns community or varbind values', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-traps')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.body.data[0]).toMatchObject({
      id: 701,
      source_ip: '10.20.30.40',
      trap_type: 'linkDown',
      device_name: 'Tower router',
    });
    expect(res.body.data[0]).not.toHaveProperty('varbinds');
    expect(res.body.data[0]).not.toHaveProperty('community');
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE_VARBIND_VALUE|PRIVATE_COMMUNITY/);
    const list = db.query.mock.calls.find(
      ([sql]) => /FROM snmp_traps t/.test(sql) && /ORDER BY t\.received_at/.test(sql),
    );
    expect(list[0]).toMatch(/t\.organization_id = \?/);
    expect(list[0]).not.toMatch(/\bt\.varbinds\b|\bt\.community\b|SELECT\s+t\.\*/);
    expect(list[1][0]).toBe(10);
  });

  test('payload-authorized detail is tenant-scoped, no-store, and still never exposes community', async () => {
    const res = await request(app)
      .get('/api/v1/snmp-traps/701')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.body.data.varbinds).toEqual([{ oid: '1.2.3', value: 'PRIVATE_VARBIND_VALUE' }]);
    expect(res.body.data).not.toHaveProperty('community');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE_COMMUNITY');
    const detail = db.query.mock.calls.find(
      ([sql]) => /FROM snmp_traps t/.test(sql) && /WHERE t\.id = \?/.test(sql),
    );
    expect(detail[0]).toMatch(/t\.organization_id = \?/);
    expect(detail[0]).not.toMatch(/\bt\.community\b|SELECT\s+t\.\*/);
    expect(detail[1]).toEqual(['701', 10]);
  });

  test('a technician with devices.view cannot fetch full varbind payload detail', async () => {
    installJwtDb({ role: 'technician', permissions: ['devices.view'] });

    const list = await request(app)
      .get('/api/v1/snmp-traps')
      .set('Authorization', `Bearer ${token({ sub: 2, role: 'technician' })}`)
      .set('X-Org-Id', '10');
    expect(list.status).toBe(200);

    const detail = await request(app)
      .get('/api/v1/snmp-traps/701')
      .set('Authorization', `Bearer ${token({ sub: 2, role: 'technician' })}`)
      .set('X-Org-Id', '10');
    expect(detail.status).toBe(403);
    expect(db.query.mock.calls.some(
      ([sql]) => /FROM snmp_traps t/.test(sql) && /WHERE t\.id = \?/.test(sql),
    )).toBe(false);
  });

  test('a non-administrative persona cannot fetch payload even when both permission slugs are assigned', async () => {
    installJwtDb({
      role: 'technician',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
    });

    const detail = await request(app)
      .get('/api/v1/snmp-traps/701')
      .set('Authorization', `Bearer ${token({ sub: 2, role: 'technician' })}`)
      .set('X-Org-Id', '10');

    expect(detail.status).toBe(403);
    expect(db.query.mock.calls.some(
      ([sql]) => /FROM snmp_traps t/.test(sql) && /WHERE t\.id = \?/.test(sql),
    )).toBe(false);
  });

  test('an admin API token scoped only to devices.view cannot bypass payload permission', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    const apiKey = 'trap-route-test-token';
    const expectedHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    db.query.mockImplementation((sql, params = []) => {
      if (/FROM api_tokens at/.test(sql)) {
        expect(params).toEqual([expectedHash]);
        return Promise.resolve([[
          {
            id: 900,
            user_id: 1,
            token_organization_id: 10,
            scopes: JSON.stringify(['devices.view']),
            scopes_sql_null: 0,
            expires_at: null,
            revoked_at: null,
            last_used_at: new Date().toISOString(),
            last_used_ip: '::ffff:127.0.0.1',
            rate_limit_policy_id: null,
            email: 'admin@test.example',
            role: 'admin',
            status: 'active',
            user_home_organization_id: 10,
            is_install_operator: 0,
          },
        ]]);
      }
      if (/SELECT id, name FROM organizations/.test(sql)) {
        return Promise.resolve([[{ id: 10, name: 'Tenant 10' }]]);
      }
      if (/SELECT role AS membership_role FROM organization_users/.test(sql)) return Promise.resolve([[]]);
      if (/COALESCE\(group_row\.kind, u\.role\) AS authority_persona/.test(sql)) {
        return Promise.resolve([[
          { id: 1, email: 'admin@test.example', role: 'admin', organization_id: 10,
            is_install_operator: 0, authority_persona: 'admin' },
        ]]);
      }
      if (/SELECT g\.id AS group_id/.test(sql)) {
        return Promise.resolve([[{ group_id: 1, has_access: 1 }]]);
      }
      if (/SELECT DISTINCT p\.name AS slug\s+FROM role_permissions/.test(sql)) {
        return Promise.resolve([[
          { slug: 'devices.view' },
          { slug: 'snmp_traps.payload.view' },
        ]]);
      }
      if (/UPDATE api_tokens SET last_used_at/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/snmp-traps/701')
      .set('X-API-Key', apiKey)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(([sql]) => /FROM snmp_traps t/.test(sql))).toBe(false);
  });
});
