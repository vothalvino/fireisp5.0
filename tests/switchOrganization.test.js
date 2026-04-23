// =============================================================================
// FireISP 5.0 — Multi-tenant: switchOrganization unit tests (M5.10)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const config = require('../src/config');
const authService = require('../src/services/authService');

const FUTURE = () => new Date(Date.now() + 86400000).toISOString();
const PAST = () => new Date(Date.now() - 60000).toISOString();

describe('authService.switchOrganization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns new token pair bound to the requested organization on success', async () => {
    const refreshTokenValue = crypto.randomBytes(32).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

    db.query
      // membership lookup
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme ISP' }]])
      // findById
      .mockResolvedValueOnce([[{ id: 1, email: 'jane@acme.test', role: 'admin', status: 'active', organization_id: 1 }]])
      // session lookup
      .mockResolvedValueOnce([[{ id: 99, token_hash: refreshHash, user_id: 1, token_family: 'fam-xyz', expires_at: FUTURE() }]])
      // DELETE old session
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // INSERT new session
      .mockResolvedValueOnce([{ insertId: 100 }]);

    const result = await authService.switchOrganization(1, 7, refreshTokenValue);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(refreshTokenValue);
    expect(result.expiresIn).toBe(900);
    expect(result.organization).toEqual({ id: 7, name: 'Acme ISP', membership_role: 'admin' });

    // Verify the new access token's orgId claim is the requested org
    const payload = jwt.verify(result.accessToken, config.jwt.secret);
    expect(payload.sub).toBe(1);
    expect(payload.orgId).toBe(7);
  });

  test('throws ValidationError when organizationId is missing', async () => {
    await expect(
      authService.switchOrganization(1, undefined, 'rt'),
    ).rejects.toThrow('organizationId is required');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('throws ForbiddenError when the user is not a member of the target org', async () => {
    db.query.mockResolvedValueOnce([[]]); // no membership rows

    await expect(
      authService.switchOrganization(1, 99, 'rt'),
    ).rejects.toThrow('User is not a member of the requested organization');
  });

  test('membership query joins organizations and excludes soft-deleted rows', async () => {
    db.query.mockResolvedValueOnce([[]]);

    await expect(
      authService.switchOrganization(1, 7, 'rt'),
    ).rejects.toThrow();

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM organization_users ou/);
    expect(sql).toMatch(/JOIN organizations o/);
    expect(sql).toMatch(/ou\.deleted_at IS NULL/);
    expect(sql).toMatch(/o\.deleted_at IS NULL/);
    expect(db.query.mock.calls[0][1]).toEqual([1, 7]);
  });

  test('throws when the user record is missing', async () => {
    db.query
      .mockResolvedValueOnce([[{ membership_role: 'support', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[]]); // findById returns nothing

    await expect(
      authService.switchOrganization(1, 7, 'rt'),
    ).rejects.toThrow('User not found or inactive');
  });

  test('throws when the user is inactive', async () => {
    db.query
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', status: 'inactive' }]]);

    await expect(
      authService.switchOrganization(1, 7, 'rt'),
    ).rejects.toThrow('User not found or inactive');
  });

  test('throws when refresh token is missing', async () => {
    db.query
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]]);

    await expect(
      authService.switchOrganization(1, 7, ''),
    ).rejects.toThrow('Refresh token required to switch organizations');
  });

  test('throws when the refresh token does not exist for this user', async () => {
    const rt = crypto.randomBytes(32).toString('hex');

    db.query
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[]]); // session lookup empty

    await expect(
      authService.switchOrganization(1, 7, rt),
    ).rejects.toThrow('Invalid or expired refresh token');
  });

  test('session lookup is scoped to the calling user (defense in depth)', async () => {
    const rt = crypto.randomBytes(32).toString('hex');

    db.query
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[]]);

    await expect(authService.switchOrganization(1, 7, rt)).rejects.toThrow();

    const sessionCall = db.query.mock.calls[2];
    expect(sessionCall[0]).toMatch(/FROM user_sessions WHERE token_hash = \? AND user_id = \?/);
    const expectedHash = crypto.createHash('sha256').update(rt).digest('hex');
    expect(sessionCall[1]).toEqual([expectedHash, 1]);
  });

  test('throws when the refresh token is expired and deletes the stale session', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');

    db.query
      .mockResolvedValueOnce([[{ membership_role: 'admin', org_id: 7, org_name: 'Acme' }]])
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 55, token_hash: rtHash, user_id: 1, token_family: 'fam', expires_at: PAST() }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE expired

    await expect(
      authService.switchOrganization(1, 7, rt),
    ).rejects.toThrow('Refresh token expired');

    const deleteCall = db.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM user_sessions WHERE id'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1]).toContain(55);
  });

  test('rotates refresh token within the same family', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');

    db.query
      .mockResolvedValueOnce([[{ membership_role: 'billing', org_id: 5, org_name: 'Beta ISP' }]])
      .mockResolvedValueOnce([[{ id: 2, email: 'b@b.c', role: 'billing', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 80, token_hash: rtHash, user_id: 2, token_family: 'fam-rotate', expires_at: FUTURE() }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE old
      .mockResolvedValueOnce([{ insertId: 81 }]);    // INSERT new

    const result = await authService.switchOrganization(2, 5, rt);

    const insertCall = db.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO user_sessions'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('fam-rotate'); // same family
    expect(insertCall[1]).toContain(2);            // user id

    const newHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
    expect(insertCall[1]).toContain(newHash);
  });
});
