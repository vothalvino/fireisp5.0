// =============================================================================
// Tenant NAS source-IP resolver — fail-closed ownership and ambiguity
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
  withTenantContext: jest.fn((_organizationId, callback) => callback()),
}));

jest.mock('../src/utils/logger', () => {
  const logger = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
});

const db = require('../src/config/database');
const resolver = require('../src/services/tenantNasResolverService');

describe('tenantNasResolverService', () => {
  const realNow = Date.now;
  let tenantContext = null;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver.invalidateNasRoutingCache();
    tenantContext = null;
    Date.now = jest.fn(() => 1_000);
    db.withPrimaryContext.mockImplementation(callback => callback());
    db.withTenantContext.mockImplementation(async (organizationId, callback) => {
      tenantContext = Number(organizationId);
      try { return await callback(); } finally { tenantContext = null; }
    });
  });

  afterAll(() => { Date.now = realNow; });

  test('fails closed instead of using a stale unique mapping after any refresh failure', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM nas n')) {
        return [[{ id: 1, organization_id: 10, ip_address: '10.0.0.1' }]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveNasByIp('10.0.0.1')).resolves.toMatchObject({
      nas: { id: 1, organization_id: 10 }, ambiguous: false, incomplete: false,
    });

    Date.now = jest.fn(() => 120_000);
    db.query.mockRejectedValue(new Error('isolated database unavailable'));

    await expect(resolver.resolveNasByIp('10.0.0.1')).resolves.toEqual({
      nas: null, ambiguous: false, matches: 0, incomplete: true,
    });
  });

  test('reports duplicate private IPs across primary and isolated databases as ambiguous', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM nas n') && tenantContext === 22) {
        return [[{ id: 2, organization_id: 22, ip_address: '10.0.0.1' }]];
      }
      if (sql.includes('FROM nas n')) {
        return [[{ id: 1, organization_id: 10, ip_address: '10.0.0.1' }]];
      }
      if (sql.includes('FROM organization_database_configs odc')) {
        return [[{ organization_id: 22 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveNasByIp('10.0.0.1')).resolves.toEqual({
      nas: null, ambiguous: true, matches: 2, incomplete: false,
    });
  });
});
