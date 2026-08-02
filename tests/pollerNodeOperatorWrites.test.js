'use strict';
// =============================================================================
// FireISP 5.0 — poller node writes are install-operator only (j36)
// =============================================================================
// A poller node is a CAPACITY UNIT OF THE DEPLOYMENT, not tenant data: you add
// one when a single box cannot keep up with the clients and contracts on it
// (poller_nodes.node_identifier matches firerelay_nodes.id). No tenant owns it,
// which is why the table has no organization_id — and why org-scoping it would
// be the wrong fix: it would mean every tenant needing their own poller,
// inverting the reason it exists.
//
// The user's call: reads stay with technicians, who need to see poller health
// for the network they are working on; writes belong to whoever runs the
// install. On a single-ISP box nothing changes — migration 444 makes every
// active admin the operator there.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const User = require('../src/models/User');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const TECH = { id: 4, email: 'tech@isp.mx', role: 'technician', status: 'active', organization_id: 1 };
const OPERATOR = { id: 1, email: 'op@isp.mx', role: 'admin', status: 'active', organization_id: 1 };

const tokenFor = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: u.organization_id },
  config.jwt.secret, { expiresIn: '1h' },
);

function wireDb(user, isOperator) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[user]];
    if (/SELECT is_install_operator FROM users/.test(sql)) {
      return [[{ is_install_operator: isOperator ? 1 : 0 }]];
    }
    if (/COUNT/.test(sql)) return [[{ total: 0 }]];
    return [[{ id: 1, name: 'poller-1', node_identifier: 'n1', status: 'active' }]];
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.replaceProperty(config, 'installOperatorUserIds', []);
  // Technicians hold the poller_nodes.* slugs today; the point of this suite is
  // that holding them is no longer enough for the write verbs.
  jest.spyOn(User, 'getPermissions').mockResolvedValue([
    'poller_nodes.view', 'poller_nodes.create', 'poller_nodes.update', 'poller_nodes.delete',
  ]);
});

describe('a technician can still SEE poller health', () => {
  it('lists nodes', async () => {
    wireDb(TECH, false);
    const res = await request(app).get('/api/v1/poller-nodes')
      .set('Authorization', `Bearer ${tokenFor(TECH)}`);
    expect(res.status).toBe(200);
  });
});

describe('but cannot change the deployment', () => {
  it('403s create', async () => {
    wireDb(TECH, false);
    const res = await request(app).post('/api/v1/poller-nodes')
      .set('Authorization', `Bearer ${tokenFor(TECH)}`)
      .send({ name: 'rogue', node_identifier: 'rogue-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTALL_OPERATOR_ONLY');
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO poller_nodes/i.test(sql))).toBe(false);
  });

  it('403s delete — org A\'s technician must not remove the poller serving org B', async () => {
    wireDb(TECH, false);
    const res = await request(app).delete('/api/v1/poller-nodes/1')
      .set('Authorization', `Bearer ${tokenFor(TECH)}`);
    expect(res.status).toBe(403);
  });

  it('403s update', async () => {
    wireDb(TECH, false);
    const res = await request(app).put('/api/v1/poller-nodes/1')
      .set('Authorization', `Bearer ${tokenFor(TECH)}`)
      .send({ name: 'renamed' });
    expect(res.status).toBe(403);
  });
});

describe('the install operator still manages them', () => {
  it('reaches delete', async () => {
    wireDb(OPERATOR, true);
    const res = await request(app).delete('/api/v1/poller-nodes/1')
      .set('Authorization', `Bearer ${tokenFor(OPERATOR)}`);
    expect(res.status).not.toBe(403);
  });
});
