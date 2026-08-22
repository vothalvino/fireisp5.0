'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/installOperator', () => ({
  isInstallOperatorUser: jest.fn(),
}));

const db = require('../src/config/database');
const { isInstallOperatorUser } = require('../src/services/installOperator');
const {
  isSuperAdminUser,
  hasGlobalOrganizationAccess,
  hasGlobalOrganizationAccessUser,
} = require('../src/services/globalOrganizationAccess');

describe('installation-wide organization access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isInstallOperatorUser.mockResolvedValue(false);
  });

  test('recognizes only the exact seeded system super_admin group', async () => {
    db.query.mockResolvedValueOnce([[{ group_name: 'super_admin', group_is_system: 1 }]]);
    await expect(isSuperAdminUser({ id: 7 })).resolves.toBe(true);

    await expect(isSuperAdminUser({
      id: 8, group_name: 'super_admin', group_is_system: 0,
    })).resolves.toBe(false);
    await expect(isSuperAdminUser({
      id: 9, role: 'admin', group_name: 'admin', group_is_system: 1,
    })).resolves.toBe(false);
  });

  test('install operators are global without needing the super_admin group', async () => {
    isInstallOperatorUser.mockResolvedValue(true);
    await expect(hasGlobalOrganizationAccessUser({ id: 1, role: 'admin' })).resolves.toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('API tokens remain organization-bound even when the browser identity is global', async () => {
    await expect(hasGlobalOrganizationAccess({
      user: { id: 1, apiTokenId: 22, hasGlobalOrganizationAccess: true },
    })).resolves.toBe(false);
    expect(isInstallOperatorUser).not.toHaveBeenCalled();
  });
});
