'use strict';

const request = require('supertest');
jest.mock('../src/config/database');
const db = require('../src/config/database');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, role: 'admin' };
    next();
  },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 1;
    next();
  },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const app = require('../src/app');

describe('GET /api/v1/interface-qos-policies', () => {
  it('returns interface QoS policies list', async () => {
    db.query
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, name: 'Main Policy', policy_type: 'htb' }]]);
    const res = await request(app)
      .get('/api/v1/interface-qos-policies')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/v1/interface-qos-policies', () => {
  it('creates an interface QoS policy', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1, name: 'New Policy', policy_type: 'htb' }]]);
    const res = await request(app)
      .post('/api/v1/interface-qos-policies')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test')
      .send({ name: 'New Policy', policy_type: 'htb' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/v1/dscp-marking-policies/export/config', () => {
  it('returns DSCP config export as JSON', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, name: 'VoIP', dscp_value: 46, dscp_name: 'EF', status: 'active' }]]);
    const res = await request(app)
      .get('/api/v1/dscp-marking-policies/export/config')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/dscp-marking-policies/export/config?format=text', () => {
  it('returns DSCP config export as text', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, name: 'VoIP', dscp_value: 46, dscp_name: 'EF', status: 'active' }]]);
    const res = await request(app)
      .get('/api/v1/dscp-marking-policies/export/config?format=text')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
    expect(res.text).toContain('mangle');
  });
});

describe('GET /api/v1/mpls-vlan-prioritization', () => {
  it('returns MPLS/VLAN rules list', async () => {
    db.query
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, name: 'MPLS EXP Rule', rule_type: 'mpls_exp' }]]);
    const res = await request(app)
      .get('/api/v1/mpls-vlan-prioritization')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/bandwidth-test-servers', () => {
  it('returns bandwidth test server list', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, name: 'Test Server 1', host: '10.0.0.1' }]]);
    const res = await request(app)
      .get('/api/v1/bandwidth-test-servers')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Mass-assignment protection tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/interface-qos-policies — mass-assignment guard', () => {
  it('strips id / organization_id / deleted_at / created_at / updated_at from INSERT', async () => {
    let capturedSql = '';
    let capturedParams = [];
    db.query.mockImplementation((sql, params) => {
      if (sql && sql.includes('INSERT')) {
        capturedSql = sql;
        capturedParams = params || [];
        return Promise.resolve([{ insertId: 99 }]);
      }
      // SELECT after insert
      return Promise.resolve([[{ id: 99, name: 'Good Policy', policy_type: 'htb', organization_id: 1 }]]);
    });

    const res = await request(app)
      .post('/api/v1/interface-qos-policies')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test')
      .send({
        name: 'Good Policy',
        policy_type: 'htb',
        // mass-assignment attempt
        id: 9999,
        organization_id: 42,
        deleted_at: '2000-01-01',
        created_at: '2000-01-01',
        updated_at: '2000-01-01',
      });

    expect(res.status).toBe(201);
    // The INSERT SQL must not contain any protected column names as writable columns
    expect(capturedSql).not.toMatch(/\bid\b\s*,/);
    expect(capturedSql).not.toContain('deleted_at');
    expect(capturedSql).not.toContain('created_at');
    expect(capturedSql).not.toContain('updated_at');
    // organization_id is set server-side — confirm the injected value 42 is NOT in params
    const hasInjectedOrgId = capturedParams.includes(42);
    expect(hasInjectedOrgId).toBe(false);
  });
});

describe('PUT /api/v1/interface-qos-policies/:id — mass-assignment guard', () => {
  it('strips protected columns from UPDATE SET clause', async () => {
    let capturedSql = '';
    db.query.mockImplementation((sql) => {
      if (sql && sql.includes('UPDATE interface_qos_policies SET')) {
        capturedSql = sql;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql && sql.includes('SELECT *') && sql.includes('WHERE id = ? AND organization_id')) {
        return Promise.resolve([[{ id: 1, name: 'Existing', policy_type: 'htb', organization_id: 1 }]]);
      }
      // Final SELECT
      return Promise.resolve([[{ id: 1, name: 'Updated', policy_type: 'htb', organization_id: 1 }]]);
    });

    const res = await request(app)
      .put('/api/v1/interface-qos-policies/1')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test')
      .send({
        name: 'Updated',
        // mass-assignment attempt
        organization_id: 42,
        deleted_at: '2000-01-01',
        id: 9999,
      });

    expect(res.status).toBe(200);
    // Protected columns must not appear in the SET clause (mass-assignment guard).
    // They legitimately remain in the WHERE clause (org-scoping + soft-delete filter).
    const setClause = capturedSql.split('WHERE')[0];
    expect(setClause).not.toContain('organization_id');
    expect(setClause).not.toContain('deleted_at');
    expect(setClause).not.toMatch(/\bid\s*=/);
  });
});
