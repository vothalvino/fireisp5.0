'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn((callback) => callback()),
}));
jest.mock('../src/models/User', () => ({
  findByIdIncludingDeleted: jest.fn(),
}));
jest.mock('../src/services/installOperator', () => ({
  isInstallOperator: jest.fn(),
  isInstallOperatorUser: jest.fn(),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');
const { isInstallOperatorUser } = require('../src/services/installOperator');
const { restrictRoleAssignment } = require('../src/middleware/restrictRoleAssignment');

async function run(req) {
  let result = Symbol('not-called');
  await restrictRoleAssignment(req, {}, (err) => { result = err; });
  return result;
}

describe('global organization-access assignment guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isInstallOperatorUser.mockResolvedValue(false);
  });

  test('a backend-resolved install operator or super administrator may assign organizations', async () => {
    const result = await run({
      method: 'POST',
      user: { id: 8, role: 'admin', hasGlobalOrganizationAccess: true },
      body: { organization_ids: [1, 100] },
    });
    expect(result).toBeUndefined();
  });

  test('an ordinary tenant admin cannot assign organization access', async () => {
    db.query.mockResolvedValueOnce([[{ group_name: 'admin', group_is_system: 1 }]]);

    const result = await run({
      method: 'POST',
      user: { id: 2, role: 'admin', hasGlobalOrganizationAccess: false },
      body: { organization_ids: [1, 100] },
    });

    expect(result).toMatchObject({ statusCode: 403 });
  });

  test('a tenant admin cannot assign the system super_admin group', async () => {
    db.query
      .mockResolvedValueOnce([[{ name: 'super_admin', is_system: 1 }]])
      .mockResolvedValueOnce([[{ group_name: 'admin', group_is_system: 1 }]]);

    const result = await run({
      method: 'POST',
      user: { id: 2, role: 'admin', hasGlobalOrganizationAccess: false },
      body: { group_id: 77 },
    });
    expect(result).toMatchObject({ statusCode: 403 });
  });

  test('a system super_admin group cannot be combined with manual organization assignments', async () => {
    db.query.mockResolvedValueOnce([[{ name: 'super_admin', is_system: 1 }]]);

    const result = await run({
      method: 'POST',
      user: { id: 8, role: 'admin', hasGlobalOrganizationAccess: true },
      body: { group_id: 77, organization_ids: [1, 100] },
    });

    expect(result).toMatchObject({ statusCode: 422 });
    expect(result.message).toMatch(/automatic access to every organization/i);
  });

  test('manual assignments are rejected for an existing system super administrator', async () => {
    User.findByIdIncludingDeleted.mockResolvedValueOnce({
      id: 9,
      role: 'admin',
      group_name: 'super_admin',
      group_is_system: 1,
    });

    const result = await run({
      method: 'PATCH',
      params: { id: '9' },
      user: { id: 8, role: 'admin', hasGlobalOrganizationAccess: true },
      body: { organization_ids: [1] },
    });

    expect(result).toMatchObject({ statusCode: 422 });
  });

  test('manual assignments are rejected for an existing install operator', async () => {
    User.findByIdIncludingDeleted.mockResolvedValueOnce({ id: 5, role: 'admin' });
    isInstallOperatorUser.mockResolvedValueOnce(true);

    const result = await run({
      method: 'PATCH',
      params: { id: '5' },
      user: { id: 8, role: 'admin', hasGlobalOrganizationAccess: true },
      body: { organization_ids: [100] },
    });

    expect(result).toMatchObject({ statusCode: 422 });
  });
});
