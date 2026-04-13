// =============================================================================
// FireISP 5.0 — RBAC Middleware Tests
// =============================================================================

jest.mock('../src/models/User', () => ({
  getPermissions: jest.fn(),
  getOrgRole: jest.fn(),
}));

const User = require('../src/models/User');
const { requirePermission, requireRole } = require('../src/middleware/rbac');

function mockReqRes(user = {}) {
  return {
    req: { user },
    res: {},
    next: jest.fn(),
  };
}

describe('requirePermission middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('allows admin to bypass permission check', async () => {
    const { req, res, next } = mockReqRes({ id: 1, role: 'admin', organizationId: 1 });
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(User.getPermissions).not.toHaveBeenCalled();
  });

  test('allows user with matching permission', async () => {
    User.getPermissions.mockResolvedValue(['clients.view', 'clients.edit']);
    const { req, res, next } = mockReqRes({ id: 2, role: 'operator', organizationId: 1 });
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows when any one of multiple required permissions matches', async () => {
    User.getPermissions.mockResolvedValue(['invoices.create']);
    const { req, res, next } = mockReqRes({ id: 2, role: 'operator', organizationId: 1 });
    const mw = requirePermission('clients.view', 'invoices.create');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('denies user without matching permission', async () => {
    User.getPermissions.mockResolvedValue(['clients.view']);
    const { req, res, next } = mockReqRes({ id: 2, role: 'operator', organizationId: 1 });
    const mw = requirePermission('users.delete');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when user has no permissions at all', async () => {
    User.getPermissions.mockResolvedValue([]);
    const { req, res, next } = mockReqRes({ id: 2, role: 'viewer', organizationId: 1 });
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when req.user is missing', async () => {
    const { req, res, next } = mockReqRes(null);
    req.user = null;
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when organizationId is missing', async () => {
    const { req, res, next } = mockReqRes({ id: 2, role: 'operator' });
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('passes database errors to next()', async () => {
    User.getPermissions.mockRejectedValue(new Error('DB error'));
    const { req, res, next } = mockReqRes({ id: 2, role: 'operator', organizationId: 1 });
    const mw = requirePermission('clients.view');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('requireRole middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('allows user with matching role', async () => {
    User.getOrgRole.mockResolvedValue('owner');
    const { req, res, next } = mockReqRes({ id: 1, organizationId: 1 });
    const mw = requireRole('owner', 'admin');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('denies user with non-matching role', async () => {
    User.getOrgRole.mockResolvedValue('viewer');
    const { req, res, next } = mockReqRes({ id: 1, organizationId: 1 });
    const mw = requireRole('owner', 'admin');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when getOrgRole returns null', async () => {
    User.getOrgRole.mockResolvedValue(null);
    const { req, res, next } = mockReqRes({ id: 1, organizationId: 1 });
    const mw = requireRole('owner');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when req.user is missing', async () => {
    const { req, res, next } = mockReqRes(null);
    req.user = null;
    const mw = requireRole('owner');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('denies when organizationId is missing', async () => {
    const { req, res, next } = mockReqRes({ id: 1 });
    const mw = requireRole('owner');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  test('passes database errors to next()', async () => {
    User.getOrgRole.mockRejectedValue(new Error('DB error'));
    const { req, res, next } = mockReqRes({ id: 1, organizationId: 1 });
    const mw = requireRole('owner');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
