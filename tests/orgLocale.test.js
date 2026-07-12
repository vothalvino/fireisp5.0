// =============================================================================
// FireISP 5.0 — requireMxLocale middleware tests
// =============================================================================

jest.mock('../src/models/Organization', () => ({
  getLocale: jest.fn(),
}));

const Organization = require('../src/models/Organization');
const { requireMxLocale } = require('../src/middleware/orgLocale');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireMxLocale', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes through when the org locale is MX', async () => {
    Organization.getLocale.mockResolvedValue('MX');
    const res = mockRes();
    const next = jest.fn();

    await new Promise((resolve) => {
      requireMxLocale({ orgId: 7 }, res, (...args) => { next(...args); resolve(); });
    });

    expect(Organization.getLocale).toHaveBeenCalledWith(7);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 404 REGION_DISABLED for a global-locale org', async () => {
    Organization.getLocale.mockResolvedValue('global');
    const res = mockRes();
    const next = jest.fn();

    requireMxLocale({ orgId: 7 }, res, next);
    await new Promise(process.nextTick);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'REGION_DISABLED',
        message: expect.stringContaining('MX'),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('forwards lookup errors to next()', async () => {
    const boom = new Error('db down');
    Organization.getLocale.mockRejectedValue(boom);
    const res = mockRes();
    const next = jest.fn();

    requireMxLocale({ orgId: 7 }, res, next);
    await new Promise(process.nextTick);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});
