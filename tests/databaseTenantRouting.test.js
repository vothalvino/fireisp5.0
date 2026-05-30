// =============================================================================
// FireISP 5.0 — Tenant-aware database pool routing tests (P2.6)
// =============================================================================

describe('database tenant routing', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.DB_REPLICA_HOST;
    delete process.env.TENANT_DB_CONFIG_CACHE_MS;
    delete process.env.TENANT_DB_POOL_MAX;
    delete process.env.TENANT_DB_POOL_IDLE_MS;
    delete process.env.TENANT_DB_SSL_REJECT_UNAUTHORIZED;
  });

  function loadDatabaseWithPools(pools) {
    const createPool = jest.fn();
    for (const p of pools) createPool.mockReturnValueOnce(p);
    jest.doMock('mysql2/promise', () => ({ createPool }));
    jest.doMock('../src/utils/dbMetrics', () => ({ recordDbQuery: jest.fn() }));
    return { db: require('../src/config/database'), createPool };
  }

  function makePool() {
    return {
      execute: jest.fn(),
      getConnection: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };
  }

  test('routes org-scoped queries to the isolated tenant pool when configured', async () => {
    const primaryPool = makePool();
    const tenantPool = makePool();
    primaryPool.execute.mockResolvedValueOnce([[{
      organization_id: 5,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3306,
      db_name: 'fireisp_org_5',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []]);
    tenantPool.execute.mockResolvedValueOnce([[{ id: 1 }], []]);

    const { db, createPool } = loadDatabaseWithPools([primaryPool, tenantPool]);

    const result = await db.withTenantContext(5, () => db.query('SELECT * FROM clients', []));

    expect(result[0]).toEqual([{ id: 1 }]);
    expect(primaryPool.execute).toHaveBeenCalledWith(expect.stringContaining('organization_database_configs'), [5]);
    expect(tenantPool.execute).toHaveBeenCalledWith('SELECT * FROM clients', []);
    expect(createPool).toHaveBeenCalledTimes(2);
  });

  test('falls back to the primary pool when tenant config is absent or shared', async () => {
    const primaryPool = makePool();
    primaryPool.execute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1 }], []]);

    const { db, createPool } = loadDatabaseWithPools([primaryPool]);

    const result = await db.withTenantContext(6, () => db.query('SELECT * FROM clients', []));

    expect(result[0]).toEqual([{ id: 1 }]);
    expect(primaryPool.execute).toHaveBeenNthCalledWith(2, 'SELECT * FROM clients', []);
    expect(createPool).toHaveBeenCalledTimes(1);
  });

  test('reuses the cached tenant pool across calls for the same org', async () => {
    const primaryPool = makePool();
    const tenantPool = makePool();
    primaryPool.execute.mockResolvedValue([[{
      organization_id: 7,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3306,
      db_name: 'fireisp_org_7',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []]);
    tenantPool.execute.mockResolvedValue([[{ id: 1 }], []]);
    process.env.TENANT_DB_CONFIG_CACHE_MS = '60000';

    const { db, createPool } = loadDatabaseWithPools([primaryPool, tenantPool]);

    await db.withTenantContext(7, () => db.query('SELECT 1', []));
    await db.withTenantContext(7, () => db.query('SELECT 2', []));

    // Only one tenant pool is created and reused for the second query.
    expect(createPool).toHaveBeenCalledTimes(2);
  });

  test('LRU-evicts the oldest tenant pool when the cache cap is exceeded', async () => {
    process.env.TENANT_DB_POOL_MAX = '1';
    process.env.TENANT_DB_CONFIG_CACHE_MS = '60000';
    const primaryPool = makePool();
    const tenantPoolA = makePool();
    const tenantPoolB = makePool();

    const configFor = (id) => [[{
      organization_id: id,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3306,
      db_name: `fireisp_org_${id}`,
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []];
    primaryPool.execute
      .mockResolvedValueOnce(configFor(8))
      .mockResolvedValueOnce(configFor(9));
    tenantPoolA.execute.mockResolvedValue([[{ id: 1 }], []]);
    tenantPoolB.execute.mockResolvedValue([[{ id: 2 }], []]);

    const { db } = loadDatabaseWithPools([primaryPool, tenantPoolA, tenantPoolB]);

    await db.withTenantContext(8, () => db.query('SELECT 1', []));
    await db.withTenantContext(9, () => db.query('SELECT 2', []));

    // Org 8's pool is the least-recently-used and must be closed on eviction.
    expect(tenantPoolA.end).toHaveBeenCalledTimes(1);
    expect(tenantPoolB.end).not.toHaveBeenCalled();
  });

  test('enables TLS with explicit certificate verification for isolated tenants', async () => {
    process.env.TENANT_DB_CONFIG_CACHE_MS = '60000';
    const primaryPool = makePool();
    const tenantPool = makePool();
    primaryPool.execute.mockResolvedValue([[{
      organization_id: 10,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3306,
      db_name: 'fireisp_org_10',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 1,
    }], []]);
    tenantPool.execute.mockResolvedValue([[{ id: 1 }], []]);

    const { db, createPool } = loadDatabaseWithPools([primaryPool, tenantPool]);

    await db.withTenantContext(10, () => db.query('SELECT 1', []));

    const tenantPoolConfig = createPool.mock.calls[1][0];
    expect(tenantPoolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });
});
