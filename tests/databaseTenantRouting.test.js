// =============================================================================
// FireISP 5.0 — Tenant-aware database pool routing tests (P2.6)
// =============================================================================

describe('database tenant routing', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.DB_REPLICA_HOST;
    delete process.env.TENANT_DB_CONFIG_CACHE_MS;
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
});
