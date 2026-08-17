'use strict';

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
const resolver = require('../src/services/tenantDeviceResolverService');

function activeDevice(row) {
  return {
    organization_status: 'active',
    organization_deleted_at: null,
    ...row,
  };
}

describe('tenantDeviceResolverService', () => {
  const realNow = Date.now;
  beforeEach(() => {
    jest.clearAllMocks();
    resolver.invalidateDeviceRoutingCache();
    Date.now = jest.fn(() => 1_000);
    db.withPrimaryContext.mockImplementation(callback => callback());
    db.withTenantContext.mockImplementation(async (_organizationId, callback) => callback());
  });

  afterAll(() => { Date.now = realNow; });

  test('fails closed install-wide when any retained isolated database config exists', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM organization_database_configs odc')) {
        expect(sql).not.toMatch(/JOIN organizations|o\.status|o\.deleted_at/);
        return [[{ organization_id: 22 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await resolver.resolveDeviceByIp('10.0.0.2');

    expect(result).toEqual({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: 'isolated_tenant_attribution_unsupported',
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM devices d'))).toBe(false);
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });

  test('does not attribute even a unique shared device while isolated mode is active', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM organization_database_configs odc')) {
        return [[{ organization_id: 22 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toEqual({
      device: null,
      ambiguous: false,
      matches: 0,
      incomplete: true,
      reason: 'isolated_tenant_attribution_unsupported',
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM devices d'))).toBe(false);
  });

  test('rechecks a previously unique IP so a direct-write duplicate immediately fails closed', async () => {
    let primaryScan = 0;
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM devices d')) {
        primaryScan += 1;
        if (primaryScan <= 2) {
          return [[activeDevice({
            id: 1, organization_id: 10, name: 'First router', ip_address: '10.0.0.1',
          })]];
        }
        return [[
          { id: 1, organization_id: 10, name: 'First router', ip_address: '10.0.0.1' },
          { id: 2, organization_id: 10, name: 'Direct-write duplicate', ip_address: '10.0.0.1' },
        ]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[{ id: 10 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toMatchObject({
      device: { id: 1, organization_id: 10 },
      matches: 1,
      ambiguous: false,
      reason: null,
    });

    // Simulates a write from another replica/process: no local invalidation hook.
    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toEqual({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });
    expect(primaryScan).toBe(4);
  });

  test('never attributes a unique device owned by a suspended or deleted organization', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM devices d')) {
        expect(sql).toMatch(/LEFT JOIN organizations o ON o\.id = d\.organization_id/);
        expect(sql).not.toMatch(/o\.status = 'active'|o\.deleted_at IS NULL/);
        return [[{
          id: 66,
          organization_id: 12,
          name: 'Suspended owner router',
          ip_address: '10.0.0.66',
          organization_status: 'suspended',
          organization_deleted_at: null,
        }]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[{ id: 12 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.66')).resolves.toEqual({
      device: null,
      matches: 1,
      ambiguous: false,
      incomplete: false,
      reason: 'source_owner_inactive',
    });
  });

  test('any second retained organization disables attribution even when it is suspended or deleted', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) {
        expect(sql).toMatch(/ORDER BY id LIMIT 2/);
        expect(sql).not.toMatch(/status|deleted_at/);
        return [[{ id: 10 }, { id: 11 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.77')).resolves.toEqual({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: 'multi_organization_attribution_unsupported',
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM devices d'))).toBe(false);
  });

  test('zero retained organizations never attributes or scans a stale shared device row', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[]];
      if (sql.includes('FROM devices d')) {
        throw new Error('device rows must not be consulted without an owning organization');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.77')).resolves.toEqual({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: false,
      reason: 'source_ip_not_registered',
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM devices d'))).toBe(false);
  });

  test('uses canonical IPv6 keys for equivalent stored and received spellings', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM devices d')) {
        return [[activeDevice({
          id: 6,
          organization_id: 10,
          name: 'IPv6 router',
          ip_address: '2001:0db8:0000:0000:0000:0000:0000:0001',
        })]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[{ id: 10 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('2001:db8::1')).resolves.toMatchObject({
      device: { id: 6, organization_id: 10 },
      matches: 1,
      ambiguous: false,
      incomplete: false,
      reason: null,
    });
  });

  test('never shares or reuses an in-flight positive lookup after a device mutation', async () => {
    let releaseFirstScan;
    let deviceScan = 0;
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM devices d')) {
        deviceScan += 1;
        if (deviceScan === 1) {
          return new Promise(resolve => {
            releaseFirstScan = () => resolve([[activeDevice({
              id: 1,
              organization_id: 10,
              name: 'Stale router',
              ip_address: '10.0.0.1',
            })]]);
          });
        }
        return Promise.resolve([[
          {
            id: 1,
            organization_id: 10,
            name: 'Original router',
            ip_address: '10.0.0.1',
          },
          {
            id: 2,
            organization_id: 10,
            name: 'Direct-write duplicate',
            ip_address: '10.0.0.1',
          },
        ]]);
      }
      if (sql.includes('FROM organization_database_configs odc')) return Promise.resolve([[]]);
      if (sql.includes('FROM organizations')) return Promise.resolve([[{ id: 10 }]]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const inFlightLookup = resolver.resolveDeviceByIp('10.0.0.1');
    await new Promise(resolve => global.setImmediate(resolve));
    expect(releaseFirstScan).toEqual(expect.any(Function));

    // A concurrent trap must perform its own authoritative scan instead of
    // joining or consuming the first lookup as a positive cache entry.
    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toEqual({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });

    releaseFirstScan();
    await expect(inFlightLookup).resolves.toEqual({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });

    // Completing the older lookup must not publish it for later traps.
    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toEqual({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });
    expect(deviceScan).toBe(6);
  });

  test('fails closed instead of using a stale unique mapping after any refresh failure', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM devices d')) {
        return [[activeDevice({
          id: 1, organization_id: 10, name: 'Router', ip_address: '10.0.0.1',
        })]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[{ id: 10 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toMatchObject({
      device: { id: 1, organization_id: 10 },
      ambiguous: false,
      incomplete: false,
    });

    Date.now = jest.fn(() => 120_000);
    db.query.mockRejectedValue(new Error('isolated database unavailable'));

    await expect(resolver.resolveDeviceByIp('10.0.0.1')).resolves.toEqual({
      device: null,
      ambiguous: false,
      matches: 0,
      incomplete: true,
      reason: 'source_attribution_unavailable',
    });
  });

  test('locks both isolation mode and exact canonical IP during final transaction confirmation', async () => {
    const lockedColumns = [];
    const exec = jest.fn(async (sql, params = []) => {
      if (sql.includes('FROM devices d')) {
        const column = sql.match(/d\.(ip_address_bin|ipv6_address_bin) = INET6_ATON\(\?\)/)?.[1];
        expect(column).toBeDefined();
        lockedColumns.push(column);
        expect(sql).toMatch(/FOR UPDATE\s*$/);
        expect(params).toEqual(['2001:db8::1']);
        return column === 'ip_address_bin' ? [[activeDevice({
          id: 8, organization_id: 10, name: 'Locked router',
          ip_address: '2001:0db8:0:0:0:0:0:1',
        })]] : [[]];
      }
      if (sql.includes('FROM organization_database_configs odc')) {
        expect(sql).toMatch(/FOR UPDATE\s*$/);
        return [[]];
      }
      if (sql.includes('FROM organizations')) {
        expect(sql).toMatch(/ORDER BY id FOR UPDATE\s*$/);
        expect(sql).not.toMatch(/status|deleted_at/);
        return [[{ id: 10 }]];
      }
      throw new Error(`Unexpected locking SQL: ${sql}`);
    });

    await expect(resolver.lockSharedDeviceByIp('2001:db8::1', exec)).resolves.toEqual({
      device: {
        id: 8,
        organization_id: 10,
        name: 'Locked router',
        ip_address: '2001:db8::1',
        database_scope: 'primary',
      },
      matches: 1,
      ambiguous: false,
      incomplete: false,
      reason: null,
    });
    expect(lockedColumns).toEqual(['ip_address_bin', 'ipv6_address_bin']);
  });

  test('final transaction confirmation fails closed when a duplicate appears after initial lookup', async () => {
    const exec = jest.fn(async (sql) => {
      if (sql.includes('FROM devices d')) {
        return [[
          { id: 1, organization_id: 10, name: 'Original', ip_address: '10.0.0.1' },
          { id: 2, organization_id: 10, name: 'Concurrent duplicate', ip_address: '10.0.0.1' },
        ]];
      }
      if (sql.includes('FROM organization_database_configs odc')) return [[]];
      if (sql.includes('FROM organizations')) return [[{ id: 10 }]];
      throw new Error(`Unexpected locking SQL: ${sql}`);
    });

    await expect(resolver.lockSharedDeviceByIp('10.0.0.1', exec)).resolves.toEqual({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });
  });
});
