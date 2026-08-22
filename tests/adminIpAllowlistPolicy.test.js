// =============================================================================
// Database-backed, opt-in admin IP allowlist policy
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const config = require('../src/config');
const {
  getAdminIpAllowlistStatus,
  enforceAdminIpAllowlist,
  statusFromEnvironment,
} = require('../src/middleware/adminIpAllowlist');

function requestFrom(ip = '203.0.113.7') {
  return {
    ip,
    socket: { remoteAddress: ip },
    user: { organizationId: 42 },
  };
}

describe('database-backed admin IP allowlist status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no active entries keeps protection disabled', async () => {
    db.query.mockResolvedValue([[]]);
    const status = await getAdminIpAllowlistStatus(42, '203.0.113.7');
    expect(status).toMatchObject({
      enabled: false,
      source: 'none',
      activeEntries: 0,
      currentIpAllowed: true,
    });
  });

  test('an explicitly active entry enables protection for its organization', async () => {
    db.query.mockResolvedValue([[
      { id: 1, organization_id: 42, cidr: '203.0.113.0/24', is_active: 1 },
    ]]);
    const status = await getAdminIpAllowlistStatus(42, '203.0.113.7');
    expect(status).toMatchObject({
      enabled: true,
      source: 'database',
      configurationValid: true,
      activeEntries: 1,
      currentIpAllowed: true,
    });
  });

  test('reports an address outside the active ranges as denied', async () => {
    db.query.mockResolvedValue([[
      { id: 1, organization_id: 42, cidr: '10.0.0.0/8', is_active: 1 },
    ]]);
    const status = await getAdminIpAllowlistStatus(42, '203.0.113.7');
    expect(status.enabled).toBe(true);
    expect(status.currentIpAllowed).toBe(false);
  });

  test('flags invalid legacy active entries instead of treating them as valid', async () => {
    db.query.mockResolvedValue([[
      { id: 1, organization_id: 42, cidr: 'not-an-address', is_active: 1 },
    ]]);
    const status = await getAdminIpAllowlistStatus(42, '203.0.113.7');
    expect(status).toMatchObject({
      enabled: true,
      configurationValid: false,
      invalidEntries: 1,
      currentIpAllowed: false,
    });
  });
});

describe('installation-wide environment override', () => {
  test('takes the configured IPv4 ranges as an active policy', () => {
    expect(statusFromEnvironment('10.0.0.0/8,203.0.113.7', '203.0.113.7')).toMatchObject({
      enabled: true,
      source: 'environment',
      configurationValid: true,
      activeEntries: 2,
      currentIpAllowed: true,
    });
  });

  test('a configured but entirely invalid override fails closed', () => {
    expect(statusFromEnvironment('not-an-address', '203.0.113.7')).toMatchObject({
      enabled: true,
      configurationValid: false,
      activeEntries: 0,
      invalidEntries: 1,
      currentIpAllowed: false,
    });
  });
});

describe('database-backed admin IP allowlist enforcement', () => {
  const originalEnv = config.env;

  beforeEach(() => {
    jest.clearAllMocks();
    config.env = 'production';
  });

  afterAll(() => {
    config.env = originalEnv;
  });

  test('allows admin traffic while the policy is not activated', async () => {
    db.query.mockResolvedValue([[]]);
    const next = jest.fn();
    await enforceAdminIpAllowlist(requestFrom(), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('blocks traffic outside an active policy', async () => {
    db.query.mockResolvedValue([[
      { id: 1, organization_id: 42, cidr: '10.0.0.0/8', is_active: 1 },
    ]]);
    const next = jest.fn();
    await enforceAdminIpAllowlist(requestFrom(), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FORBIDDEN',
    }));
  });
});
