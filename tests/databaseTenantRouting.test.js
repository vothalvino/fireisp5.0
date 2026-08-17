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

  test('withPrimaryContext overrides an enclosing isolated tenant context', async () => {
    const primaryPool = makePool();
    const tenantPool = makePool();
    primaryPool.execute
      .mockResolvedValueOnce([[{
        organization_id: 12,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_12',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 0,
      }], []])
      .mockResolvedValueOnce([[{ source: 'primary' }], []]);
    tenantPool.execute.mockResolvedValueOnce([[{ source: 'tenant' }], []]);

    const { db } = loadDatabaseWithPools([primaryPool, tenantPool]);

    const result = await db.withTenantContext(12, async () => {
      await db.query('SELECT tenant_first', []);
      return db.withPrimaryContext(() => db.query('SELECT primary_only', []));
    });

    expect(result[0]).toEqual([{ source: 'primary' }]);
    expect(primaryPool.execute).toHaveBeenLastCalledWith('SELECT primary_only', []);
    expect(tenantPool.execute).toHaveBeenCalledWith('SELECT tenant_first', []);
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

    // The pool may be reused, but the routing registry itself is re-read from
    // primary for every decision so another application replica can revoke or
    // replace isolation without waiting for a process-local TTL.
    const registryReads = primaryPool.execute.mock.calls.filter(
      ([sql]) => /organization_database_configs/.test(sql),
    );
    expect(registryReads).toHaveLength(2);
    expect(createPool).toHaveBeenCalledTimes(2);
  });

  test('tenant routing reads the authoritative primary registry even when a read replica exists', async () => {
    process.env.DB_REPLICA_HOST = 'read-replica';
    const primaryPool = makePool();
    const replicaPool = makePool();
    const tenantPool = makePool();
    primaryPool.execute.mockResolvedValueOnce([[
      {
        organization_id: 14,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_14',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 0,
      },
    ], []]);
    replicaPool.execute.mockRejectedValue(new Error('replica must not route tenant databases'));
    tenantPool.execute.mockResolvedValueOnce([[{ source: 'isolated-primary-registry' }], []]);

    const { db } = loadDatabaseWithPools([primaryPool, replicaPool, tenantPool]);

    await expect(db.withTenantContext(14, () => db.query('SELECT routed', [])))
      .resolves.toEqual([[{ source: 'isolated-primary-registry' }], []]);
    expect(primaryPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('organization_database_configs'),
      [14],
    );
    expect(replicaPool.execute).not.toHaveBeenCalled();
    expect(tenantPool.execute).toHaveBeenCalledWith('SELECT routed', []);
  });

  test('a cross-replica config change replaces a cached tenant pool by fingerprint', async () => {
    process.env.TENANT_DB_CONFIG_CACHE_MS = '60000';
    const primaryPool = makePool();
    const oldTenantPool = makePool();
    const newTenantPool = makePool();
    const config = (host, name) => [[{
      organization_id: 15,
      isolation_mode: 'isolated',
      db_host: host,
      db_port: 3306,
      db_name: name,
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []];
    primaryPool.execute
      .mockResolvedValueOnce(config('old-tenant-db', 'fireisp_org_15_old'))
      .mockResolvedValueOnce(config('new-tenant-db', 'fireisp_org_15_new'));
    oldTenantPool.execute.mockResolvedValueOnce([[{ generation: 'old' }], []]);
    newTenantPool.execute.mockResolvedValueOnce([[{ generation: 'new' }], []]);

    const { db, createPool } = loadDatabaseWithPools([
      primaryPool,
      oldTenantPool,
      newTenantPool,
    ]);

    await expect(db.withTenantContext(15, () => db.query('SELECT first', [])))
      .resolves.toEqual([[{ generation: 'old' }], []]);
    await expect(db.withTenantContext(15, () => db.query('SELECT second', [])))
      .resolves.toEqual([[{ generation: 'new' }], []]);

    expect(primaryPool.execute.mock.calls.filter(
      ([sql]) => /organization_database_configs/.test(sql),
    )).toHaveLength(2);
    expect(oldTenantPool.end).toHaveBeenCalledTimes(1);
    expect(newTenantPool.execute).toHaveBeenCalledWith('SELECT second', []);
    expect(createPool).toHaveBeenCalledTimes(3);
  });

  test('an invalidation racing a slow config lookup cannot republish the stale isolated route', async () => {
    process.env.TENANT_DB_CONFIG_CACHE_MS = '60000';
    const primaryPool = makePool();
    const staleTenantPool = makePool();
    let releaseOldLookup;
    primaryPool.execute
      .mockImplementationOnce(() => new Promise(resolve => { releaseOldLookup = resolve; }))
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ source: 'primary-after-switch' }], []]);

    const { db, createPool } = loadDatabaseWithPools([primaryPool, staleTenantPool]);
    const routedQuery = db.withTenantContext(
      5,
      () => db.query('SELECT after_isolation_switch', []),
    );
    await new Promise(resolve => global.setImmediate(resolve));
    expect(releaseOldLookup).toEqual(expect.any(Function));

    await db.invalidateTenantDbConfig(5);
    releaseOldLookup([[{
      organization_id: 5,
      isolation_mode: 'isolated',
      db_host: 'stale-tenant-db',
      db_port: 3306,
      db_name: 'fireisp_org_5_stale',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []]);

    await expect(routedQuery).resolves.toEqual([[{ source: 'primary-after-switch' }], []]);
    expect(primaryPool.execute).toHaveBeenNthCalledWith(
      3,
      'SELECT after_isolation_switch',
      [],
    );
    expect(staleTenantPool.execute).not.toHaveBeenCalled();
    expect(createPool).toHaveBeenCalledTimes(1);
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
