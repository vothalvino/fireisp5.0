jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn((callback) => callback()),
}));

jest.mock('../src/services/installOperator', () => ({
  isInstallOperatorUser: jest.fn(),
}));

const db = require('../src/config/database');
const { isInstallOperatorUser } = require('../src/services/installOperator');
const { resolveOrgPrincipal } = require('../src/services/orgPrincipalService');

function controlRows({
  org = { id: 7, name: 'MX' },
  membershipRole = 'readonly',
  liveUser = {
    id: 1,
    email: 'user@example.test',
    role: 'readonly',
    organization_id: 7,
    is_install_operator: 0,
    authority_persona: 'readonly',
  },
} = {}) {
  db.query
    .mockResolvedValueOnce([org ? [org] : []])
    .mockResolvedValueOnce([membershipRole ? [{ membership_role: membershipRole }] : []])
    .mockResolvedValueOnce([liveUser ? [liveUser] : []]);
}

describe('resolveOrgPrincipal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isInstallOperatorUser.mockResolvedValue(false);
  });

  test('accepts a live home membership whose persona matches the authoritative group kind', async () => {
    controlRows();

    await expect(resolveOrgPrincipal({ id: 1, organization_id: 7 }, 7)).resolves.toMatchObject({
      organizationId: 7,
      membershipRole: 'readonly',
      authorizationRole: 'readonly',
      accessKind: 'membership',
    });
  });

  test('fails closed for a home-organization SSO/group membership mismatch', async () => {
    controlRows({
      membershipRole: 'readonly',
      liveUser: {
        id: 1, role: 'admin', authority_persona: 'admin', organization_id: 7,
        is_install_operator: 0,
      },
    });

    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toBeNull();
  });

  test('fails closed for a cross-organization group/membership mismatch', async () => {
    controlRows({
      membershipRole: 'readonly',
      liveUser: {
        id: 1, role: 'readonly', authority_persona: 'admin', organization_id: 1,
        is_install_operator: 0,
      },
    });

    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toBeNull();
  });

  test('treats owner and admin as the same administrative persona', async () => {
    controlRows({
      membershipRole: 'owner',
      liveUser: {
        id: 1, role: 'admin', authority_persona: 'admin', organization_id: 7,
        is_install_operator: 0,
      },
    });

    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toMatchObject({
      membershipRole: 'owner',
      authorizationRole: 'admin',
    });
  });

  test('allows the live home authority when legacy data has no membership row', async () => {
    controlRows({ membershipRole: null });

    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toMatchObject({
      membershipRole: 'readonly',
      authorizationRole: 'readonly',
      accessKind: 'home',
    });
  });

  test('allows a verified install operator into a nonmember organization for JWT requests', async () => {
    controlRows({
      membershipRole: null,
      liveUser: {
        id: 1, role: 'admin', authority_persona: 'admin', organization_id: 1,
        is_install_operator: 1,
      },
    });
    isInstallOperatorUser.mockResolvedValue(true);

    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toMatchObject({
      organizationId: 7,
      membershipRole: 'admin',
      isInstallOperator: true,
      accessKind: 'install_operator',
    });
  });

  test('never grants the install-operator carve-out to an API token', async () => {
    controlRows({
      membershipRole: null,
      liveUser: {
        id: 1, role: 'admin', authority_persona: 'admin', organization_id: 1,
        is_install_operator: 1,
      },
    });
    isInstallOperatorUser.mockResolvedValue(true);

    await expect(resolveOrgPrincipal({ id: 1 }, 7, { allowOperator: false })).resolves.toBeNull();
    expect(isInstallOperatorUser).not.toHaveBeenCalled();
  });

  test('rejects an inactive/deleted organization or inactive user row', async () => {
    controlRows({ org: null });
    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toBeNull();

    controlRows({ liveUser: null });
    await expect(resolveOrgPrincipal({ id: 1 }, 7)).resolves.toBeNull();
  });
});
