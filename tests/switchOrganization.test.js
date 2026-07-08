// =============================================================================
// FireISP 5.0 — Multi-tenant: switchOrganization unit tests (M5.10)
// =============================================================================
// Query order in switchOrganization():
//   1. User.findById            → [[user]]
//   2. organizations exists      → [[{id,name}]]
//   3. organization_users member → [[{membership_role}]] or [[]]
//   4. user_sessions lookup      → [[session]]
// The rotation itself (DELETE claim + INSERT successor) runs in a transaction
// on a dedicated connection — see mockSessionTxn below.

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


// Rotation (consume old + insert successor) runs in a transaction on a
// dedicated connection (authService.consumeAndReplaceSession) — mock it.
function mockSessionTxn(...executeResults) {
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  for (const r of executeResults) conn.execute.mockResolvedValueOnce(r);
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

const FUTURE = () => new Date(Date.now() + 86400000).toISOString();
const PAST = () => new Date(Date.now() - 60000).toISOString();

describe('authService.switchOrganization', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns new token pair bound to the requested organization for a member', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');

    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'jane@acme.test', role: 'support', status: 'active', organization_id: 1 }]]) // findById
      .mockResolvedValueOnce([[{ id: 7, name: 'Acme ISP' }]]) // org exists
      .mockResolvedValueOnce([[{ membership_role: 'support' }]]) // membership
      .mockResolvedValueOnce([[{ id: 99, token_hash: rtHash, user_id: 1, token_family: 'fam-xyz', expires_at: FUTURE() }]]); // session
    mockSessionTxn([{ affectedRows: 1 }], [{ insertId: 100 }]);

    const result = await authService.switchOrganization(1, 7, rt);

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(rt);
    expect(result.expiresIn).toBe(3600); // 60-minute access token
    expect(result.organization).toEqual({ id: 7, name: 'Acme ISP', membership_role: 'support' });

    const payload = jwt.verify(result.accessToken, config.jwt.secret);
    expect(payload.sub).toBe(1);
    expect(payload.orgId).toBe(7);
  });

  test('admin can switch to an org they are NOT a member of', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');

    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'admin@x', role: 'admin', status: 'active', organization_id: 1 }]]) // findById
      .mockResolvedValueOnce([[{ id: 42, name: 'Other ISP' }]]) // org exists
      .mockResolvedValueOnce([[]]) // NO membership
      .mockResolvedValueOnce([[{ id: 5, token_hash: rtHash, user_id: 1, token_family: 'fam', expires_at: FUTURE() }]]);
    mockSessionTxn([{ affectedRows: 1 }], [{ insertId: 6 }]);

    const result = await authService.switchOrganization(1, 42, rt);

    expect(result.organization).toEqual({ id: 42, name: 'Other ISP', membership_role: 'admin' });
    const payload = jwt.verify(result.accessToken, config.jwt.secret);
    expect(payload.orgId).toBe(42);
  });

  test('non-admin CANNOT switch to an org they are not a member of', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 2, email: 'u@x', role: 'support', status: 'active' }]]) // findById
      .mockResolvedValueOnce([[{ id: 42, name: 'Other ISP' }]]) // org exists
      .mockResolvedValueOnce([[]]); // no membership

    await expect(authService.switchOrganization(2, 42, 'rt'))
      .rejects.toThrow('User is not a member of the requested organization');
  });

  test('throws ForbiddenError when the target org does not exist', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active' }]]) // findById
      .mockResolvedValueOnce([[]]); // org not found

    await expect(authService.switchOrganization(1, 999, 'rt'))
      .rejects.toThrow('Organization not found');
  });

  test('throws ValidationError when organizationId is missing', async () => {
    await expect(authService.switchOrganization(1, undefined, 'rt'))
      .rejects.toThrow('organizationId is required');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('throws when the user record is missing', async () => {
    db.query.mockResolvedValueOnce([[]]); // findById empty
    await expect(authService.switchOrganization(1, 7, 'rt'))
      .rejects.toThrow('User not found or inactive');
  });

  test('throws when the user is inactive', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'inactive' }]]);
    await expect(authService.switchOrganization(1, 7, 'rt'))
      .rejects.toThrow('User not found or inactive');
  });

  test('throws when refresh token is missing', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ membership_role: 'admin' }]]);
    await expect(authService.switchOrganization(1, 7, ''))
      .rejects.toThrow('Refresh token required to switch organizations');
  });

  test('throws when the refresh token does not exist for this user', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ membership_role: 'admin' }]])
      .mockResolvedValueOnce([[]]); // session empty
    await expect(authService.switchOrganization(1, 7, rt))
      .rejects.toThrow('Invalid or expired refresh token');
  });

  test('session lookup is scoped to the calling user (defense in depth)', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ membership_role: 'admin' }]])
      .mockResolvedValueOnce([[]]);
    await expect(authService.switchOrganization(1, 7, rt)).rejects.toThrow();

    const sessionCall = db.query.mock.calls.find(c =>
      typeof c[0] === 'string' && /FROM user_sessions WHERE token_hash = \? AND user_id = \?/.test(c[0]));
    expect(sessionCall).toBeDefined();
    const expectedHash = crypto.createHash('sha256').update(rt).digest('hex');
    expect(sessionCall[1]).toEqual([expectedHash, 1]);
  });

  test('throws when the refresh token is expired and deletes the stale session', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ membership_role: 'admin' }]])
      .mockResolvedValueOnce([[{ id: 55, token_hash: rtHash, user_id: 1, token_family: 'fam', expires_at: PAST() }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE expired
    await expect(authService.switchOrganization(1, 7, rt)).rejects.toThrow('Refresh token expired');

    const deleteCall = db.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM user_sessions WHERE id'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1]).toContain(55);
  });

  test('rotates refresh token within the same family', async () => {
    const rt = crypto.randomBytes(32).toString('hex');
    const rtHash = crypto.createHash('sha256').update(rt).digest('hex');
    db.query
      .mockResolvedValueOnce([[{ id: 2, email: 'b@b.c', role: 'billing', status: 'active', organization_id: 1 }]]) // findById
      .mockResolvedValueOnce([[{ id: 5, name: 'Beta ISP' }]]) // org
      .mockResolvedValueOnce([[{ membership_role: 'billing' }]]) // membership
      .mockResolvedValueOnce([[{ id: 80, token_hash: rtHash, user_id: 2, token_family: 'fam-rotate', expires_at: FUTURE() }]]);
    const conn = mockSessionTxn([{ affectedRows: 1 }], [{ insertId: 81 }]);

    const result = await authService.switchOrganization(2, 5, rt);

    const insertCall = conn.execute.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO user_sessions'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('fam-rotate'); // same family
    expect(insertCall[1]).toContain(2); // user id
    const newHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
    expect(insertCall[1]).toContain(newHash);
  });
});
