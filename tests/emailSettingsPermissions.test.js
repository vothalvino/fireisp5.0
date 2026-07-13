// =============================================================================
// FireISP 5.0 — Email Settings RBAC enforcement (real auth + rbac, no mocks)
// =============================================================================
// Verifies the migration 386 permission grant matrix end-to-end through the
// REAL authenticate/orgScope/rbac middleware chain (not the bypassed mock
// used by tests/emailSettings.test.js): email_settings.view/update must be
// admin/super_admin ONLY — a role that has plenty of other *.view grants
// (mirroring readonly/billing/support/technician, none of which are seeded
// for this slug per migration 386) must still be refused. Getting this grant
// wrong (e.g. accidentally sweeping it into a readonly *.view wildcard) would
// replicate the exact bug migration 383 fixed for RADIUS credentials.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function tokenFor(role) {
  return jwt.sign({ sub: 2, email: 'user@test.com', role, orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
}

/**
 * Wires db.query to answer the three queries User.getPermissions() issues
 * (group check, org-membership-role check, legacy users.role fallback) plus
 * the plain user lookup authenticate() needs — in that priority order, most
 * specific first, mirroring tests/assets.test.js's dispatcher style.
 */
function mockAuthAndPermissions({ role, grantedSlugs = [] }) {
  db.query.mockImplementation((sql) => {
    if (typeof sql !== 'string') return Promise.resolve([[]]);

    if (sql.includes('FROM users u') && sql.includes('JOIN roles g')) {
      return Promise.resolve([[]]); // no group_id -> groupUser undefined, falls through
    }
    if (sql.includes('FROM organization_users ou') && sql.includes('JOIN roles r')) {
      return Promise.resolve([[]]); // no membership row -> falls through to legacy
    }
    if (sql.includes('FROM users u') && sql.includes('r.name = u.role')) {
      return Promise.resolve([grantedSlugs.map((slug) => ({ slug }))]);
    }
    if (sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 2, email: 'user@test.com', role, status: 'active', organization_id: 1 }]]);
    }
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('email_settings.* permission grant matrix', () => {
  it('legacy users.role="admin" bypasses RBAC entirely (GET returns 200)', async () => {
    mockAuthAndPermissions({ role: 'admin', grantedSlugs: [] });
    const res = await request(app)
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(200);
  });

  it('a role granted email_settings.view (simulating super_admin per migration 386) gets 200 on GET', async () => {
    mockAuthAndPermissions({ role: 'super_admin', grantedSlugs: ['email_settings.view', 'email_settings.update'] });
    const res = await request(app)
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${tokenFor('super_admin')}`);
    expect(res.status).toBe(200);
  });

  it('a role with many other *.view grants but NOT email_settings.view (simulating billing) gets 403 on GET', async () => {
    mockAuthAndPermissions({
      role: 'billing',
      grantedSlugs: ['invoices.view', 'invoices.create', 'clients.view', 'payments.view', 'invoice_settings.view'],
    });
    const res = await request(app)
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${tokenFor('billing')}`);
    expect(res.status).toBe(403);
  });

  it('a role with the readonly-style blanket *.view wildcard but NOT email_settings.view gets 403 on GET (the migration 377/383 carve-out)', async () => {
    mockAuthAndPermissions({
      role: 'readonly',
      grantedSlugs: ['clients.view', 'invoices.view', 'contracts.view', 'devices.view', 'tickets.view'],
    });
    const res = await request(app)
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${tokenFor('readonly')}`);
    expect(res.status).toBe(403);
  });

  it('support without email_settings.update gets 403 on PUT', async () => {
    mockAuthAndPermissions({ role: 'support', grantedSlugs: ['tickets.view', 'tickets.create', 'clients.view'] });
    const res = await request(app)
      .put('/api/v1/email-settings')
      .set('Authorization', `Bearer ${tokenFor('support')}`)
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it('technician without email_settings.update gets 403 on POST /test', async () => {
    mockAuthAndPermissions({ role: 'technician', grantedSlugs: ['work_orders.view', 'devices.view'] });
    const res = await request(app)
      .post('/api/v1/email-settings/test')
      .set('Authorization', `Bearer ${tokenFor('technician')}`)
      .send({ to: 'me@example.com' });
    expect(res.status).toBe(403);
  });
});
