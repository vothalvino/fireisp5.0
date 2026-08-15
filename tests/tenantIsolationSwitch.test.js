'use strict';
// =============================================================================
// FireISP 5.0 — real tenant isolation: who may switch into an organisation (j67)
// =============================================================================
// switchOrganization used to read:
//
//     if (memberRows.length === 0 && user.role !== 'admin') throw Forbidden
//
// commented as a deliberate "relaxed-isolation model: one operator can manage
// every ISP". The premise was false. `roles` is a GLOBAL table, migration 378
// marks both the `admin` and `super_admin` groups kind='admin', and
// User.resolveGroupMirror copies group.kind into users.role — so EVERY
// organisation's admin held that carve-out.
//
// The consequence was the worst kind, because nothing looked wrong: org A's
// admin minted a token whose orgId claim was org B, and from then on every
// org-scoped route served them org B's data correctly. req.orgId IS the claim,
// so no route guard could tell. The user chose real isolation, so membership is
// now required for everyone except the install operator — a stored fact
// (migration 444) that no request can grant.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
  withPrimaryContext: jest.fn((callback) => callback()),
}));
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));

const db = require('../src/config/database');
const User = require('../src/models/User');
const authService = require('../src/services/authService');
const config = require('../src/config');

const TENANT_ADMIN = { id: 2, email: 'admin@tenant-a.mx', role: 'admin', status: 'active', organization_id: 2 };
const OPERATOR = { id: 1, email: 'op@isp.mx', role: 'admin', status: 'active', organization_id: 1 };
const MANAGER = { id: 3, email: 'mgr@tenant-a.mx', role: 'manager', status: 'active', organization_id: 2 };

/**
 * @param member   is the user a member of the TARGET org?
 * @param operator does users.is_install_operator say they run the install?
 */
function wireDb({ user, member = false, operator = false } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM organizations\s+WHERE id/.test(sql)) return [[{ id: 9, name: 'Other ISP' }]];
    if (/SELECT role AS membership_role FROM organization_users/.test(sql)) {
      return [member ? [{ membership_role: user.role }] : []];
    }
    if (/FROM users u/.test(sql)) {
      return [[{
        ...user,
        is_install_operator: operator ? 1 : 0,
        authority_persona: user.role,
      }]];
    }
    if (/SELECT is_install_operator FROM users/.test(sql)) {
      return [[{ is_install_operator: operator ? 1 : 0 }]];
    }
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(config, 'installOperatorUserIds', []);
});

describe('a tenant admin cannot switch into an organisation they do not belong to', () => {
  it('refuses, despite carrying users.role=admin', async () => {
    User.findById.mockResolvedValue(TENANT_ADMIN);
    wireDb({ user: TENANT_ADMIN, member: false, operator: false });

    await expect(authService.switchOrganization(TENANT_ADMIN.id, 9, 'refresh-token'))
      .rejects.toThrow(/not a member/i);
  });

  it('refuses a non-admin the same way — unchanged behaviour', async () => {
    User.findById.mockResolvedValue(MANAGER);
    wireDb({ user: MANAGER, member: false, operator: false });

    await expect(authService.switchOrganization(MANAGER.id, 9, 'refresh-token'))
      .rejects.toThrow(/not a member/i);
  });

  it('never mints a token for the refused switch', async () => {
    User.findById.mockResolvedValue(TENANT_ADMIN);
    wireDb({ user: TENANT_ADMIN, member: false, operator: false });

    await expect(authService.switchOrganization(TENANT_ADMIN.id, 9, 'refresh-token')).rejects.toThrow();
    // The refresh-token rotation is what issues the new orgId claim; it must
    // never be reached.
    expect(db.query.mock.calls.some(([sql]) => /refresh_tokens/i.test(sql))).toBe(false);
  });
});

describe('who may still switch', () => {
  it('a member switches into their own organisation', async () => {
    User.findById.mockResolvedValue(MANAGER);
    wireDb({ user: MANAGER, member: true, operator: false });

    // Membership passes the guard; the call proceeds to token rotation, which
    // this suite does not stub — the assertion is only that it is NOT the
    // membership check that stops it.
    await expect(authService.switchOrganization(MANAGER.id, 9, 'refresh-token'))
      .rejects.not.toThrow(/not a member/i);
  });

  it('the install operator switches into any organisation', async () => {
    User.findById.mockResolvedValue(OPERATOR);
    wireDb({ user: OPERATOR, member: false, operator: true });

    await expect(authService.switchOrganization(OPERATOR.id, 9, 'refresh-token'))
      .rejects.not.toThrow(/not a member/i);
  });

  it('an INSTALL_OPERATOR_USER_IDS account switches even with the flag unset', async () => {
    jest.replaceProperty(config, 'installOperatorUserIds', [OPERATOR.id]);
    User.findById.mockResolvedValue(OPERATOR);
    wireDb({ user: OPERATOR, member: false, operator: false });

    await expect(authService.switchOrganization(OPERATOR.id, 9, 'refresh-token'))
      .rejects.not.toThrow(/not a member/i);
  });
});
