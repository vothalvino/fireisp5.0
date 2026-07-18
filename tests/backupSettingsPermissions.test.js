// =============================================================================
// FireISP 5.0 — Backup Settings RBAC enforcement (real auth + rbac, no mocks)
// =============================================================================
// Verifies the migration 404 permission grant matrix end-to-end through the
// REAL authenticate/rbac middleware chain (not the bypassed mock used by
// tests/backupSettings.test.js): backup_settings.view/update must be
// admin/super_admin ONLY — a role with plenty of other *.view grants
// (mirroring readonly/billing/support/technician, none of which are seeded
// for this slug per migration 404) must still be refused. A database-backup
// credential is instance-wide infrastructure; sweeping it into a readonly
// *.view wildcard would replicate the exact bug migration 383 fixed for
// RADIUS credentials.
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
 * Wires db.query to answer the queries User.getPermissions() issues plus the
 * user lookup authenticate() needs — most specific first (the
 * emailSettingsPermissions.test.js dispatcher style). backup_settings /
 * backup_runs / scheduled_tasks branches come BEFORE the generic
 * `WHERE id = ?` user lookup: `SELECT * FROM backup_settings WHERE id = ?`
 * would otherwise match the user-lookup clause and return a user row as the
 * settings row.
 */
function mockAuthAndPermissions({ role, grantedSlugs = [] }) {
  db.query.mockImplementation((sql) => {
    if (typeof sql !== 'string') return Promise.resolve([[]]);

    if (sql.includes('FROM backup_settings') || sql.includes('FROM backup_runs') || sql.includes('FROM scheduled_tasks')) {
      return Promise.resolve([[]]);
    }
    if (sql.includes('FROM users u') && sql.includes('JOIN roles g')) {
      return Promise.resolve([[]]);
    }
    if (sql.includes('FROM organization_users ou') && sql.includes('JOIN roles r')) {
      return Promise.resolve([[]]);
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

describe('backup_settings RBAC', () => {
  it('legacy admin bypass can read settings', async () => {
    mockAuthAndPermissions({ role: 'admin', grantedSlugs: [] });
    const res = await request(app)
      .get('/api/v1/backup-settings')
      .set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(200);
  });

  it('a readonly-style role with many OTHER view grants is refused (view not seeded)', async () => {
    mockAuthAndPermissions({
      role: 'readonly',
      grantedSlugs: ['clients.view', 'invoices.view', 'devices.view', 'settings.view', 'email_logs.view'],
    });
    const res = await request(app)
      .get('/api/v1/backup-settings')
      .set('Authorization', `Bearer ${tokenFor('readonly')}`);
    expect(res.status).toBe(403);
  });

  it('backup_settings.view grants GET but not PUT', async () => {
    mockAuthAndPermissions({ role: 'support', grantedSlugs: ['backup_settings.view'] });
    const get = await request(app)
      .get('/api/v1/backup-settings')
      .set('Authorization', `Bearer ${tokenFor('support')}`);
    expect(get.status).toBe(200);

    const put = await request(app)
      .put('/api/v1/backup-settings')
      .set('Authorization', `Bearer ${tokenFor('support')}`)
      .send({ remote_enabled: false });
    expect(put.status).toBe(403);
  });

  it('write endpoints (test, run-now) require backup_settings.update', async () => {
    mockAuthAndPermissions({ role: 'billing', grantedSlugs: ['backup_settings.view'] });
    for (const call of [
      request(app).post('/api/v1/backup-settings/test'),
      request(app).post('/api/v1/backup-settings/run-now'),
    ]) {
      const res = await call.set('Authorization', `Bearer ${tokenFor('billing')}`);
      expect(res.status).toBe(403);
    }
  });

  it('unauthenticated requests are refused outright', async () => {
    const res = await request(app).get('/api/v1/backup-settings');
    expect(res.status).toBe(401);
  });
});
