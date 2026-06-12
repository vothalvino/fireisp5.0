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
