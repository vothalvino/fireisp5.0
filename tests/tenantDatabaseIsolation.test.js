// =============================================================================
// FireISP 5.0 — Per-tenant database isolation tests (P2.6)
// =============================================================================

const mockQuery = jest.fn();
const mockInvalidateTenantDbConfig = jest.fn();
const mockTestTenantConnection = jest.fn();

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  invalidateTenantDbConfig: mockInvalidateTenantDbConfig,
  testTenantConnection: mockTestTenantConnection,
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const OrganizationDatabaseConfig = require('../src/models/OrganizationDatabaseConfig');
const {
  validateIsolationPayload,
  getDatabaseIsolation,
  saveDatabaseIsolation,
  testDatabaseIsolation,
  listIsolatedMigrationTargets,
} = require('../src/services/tenantDatabaseService');

describe('OrganizationDatabaseConfig', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns shared defaults when no config row exists', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    const cfg = await OrganizationDatabaseConfig.findByOrgId(42);

    expect(cfg).toMatchObject({
      organization_id: 42,
      isolation_mode: 'shared',
      db_port: 3306,
      has_password: false,
    });
  });

  test('masks encrypted password in public config', async () => {
    mockQuery.mockResolvedValueOnce([[{
      organization_id: 7,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3307,
      db_name: 'fireisp_org_7',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 1,
    }], []]);

    const cfg = await getDatabaseIsolation(7);

    expect(cfg.has_password).toBe(true);
    expect(cfg).not.toHaveProperty('db_password');
    expect(cfg).not.toHaveProperty('db_password_encrypted');
  });

  test('upserts isolated config and invalidates tenant DB cache', async () => {
    mockQuery
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{
        organization_id: 7,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_7',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 0,
      }], []]);

    const cfg = await saveDatabaseIsolation(7, {
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_name: 'fireisp_org_7',
      db_user: 'tenant_user',
      db_password: 'secret',
    });

    expect(cfg.isolation_mode).toBe('isolated');
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO organization_database_configs/i);
    expect(mockQuery.mock.calls[2][1]).toContain('secret');
    expect(mockInvalidateTenantDbConfig).toHaveBeenCalledWith(7);
  });

  test('shared mode clears isolated connection fields', async () => {
    mockQuery
      .mockResolvedValueOnce([[{
        organization_id: 7,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_7',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 1,
      }], []])
      .mockResolvedValueOnce([[{
        organization_id: 7,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_7',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 1,
      }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{
        organization_id: 7,
        isolation_mode: 'shared',
        db_host: null,
        db_port: 3306,
        db_name: null,
        db_user: null,
        db_password_encrypted: null,
        ssl_enabled: 0,
      }], []]);

    const cfg = await saveDatabaseIsolation(7, { isolation_mode: 'shared' });

    const params = mockQuery.mock.calls[2][1];
    expect(cfg.isolation_mode).toBe('shared');
    expect(params).toEqual(expect.arrayContaining([null, null, null, null]));
  });
});

describe('tenantDatabaseService validation', () => {
  test('rejects unknown fields', () => {
    expect(() => validateIsolationPayload({ isolation_mode: 'shared', bad: true }))
      .toThrow('Unknown database isolation field');
  });

  test('rejects invalid port', () => {
    expect(() => validateIsolationPayload({ isolation_mode: 'isolated', db_port: 70000 }))
      .toThrow('db_port must be an integer');
  });

  test('requires connection fields for isolated mode', () => {
    expect(() => validateIsolationPayload({ isolation_mode: 'isolated' }))
      .toThrow('db_host is required');
  });

  test('allows isolated update to reuse an existing password', () => {
    const fields = validateIsolationPayload(
      { isolation_mode: 'isolated', db_host: 'new-db' },
      {
        isolation_mode: 'isolated',
        db_host: 'old-db',
        db_name: 'fireisp_org_9',
        db_user: 'tenant_user',
        has_password: true,
      },
    );
    expect(fields.db_host).toBe('new-db');
  });
});

describe('tenantDatabaseService connection checks and migrations', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('tests configured isolated database and records verification time', async () => {
    mockQuery
      .mockResolvedValueOnce([[{
        organization_id: 9,
        isolation_mode: 'isolated',
        db_host: 'tenant-db',
        db_port: 3306,
        db_name: 'fireisp_org_9',
        db_user: 'tenant_user',
        db_password_encrypted: 'secret',
        ssl_enabled: 1,
      }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockTestTenantConnection.mockResolvedValueOnce(true);

    await expect(testDatabaseIsolation(9)).resolves.toEqual({ ok: true });

    expect(mockTestTenantConnection).toHaveBeenCalledWith(expect.objectContaining({
      host: 'tenant-db',
      database: 'fireisp_org_9',
      user: 'tenant_user',
      password: 'secret',
      ssl: {},
    }));
    expect(mockQuery.mock.calls[1][0]).toMatch(/last_verified_at = NOW\(\)/i);
  });

  test('rejects test when no isolated config is enabled', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await expect(testDatabaseIsolation(9)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('lists isolated migration targets with decrypted connection configs', async () => {
    mockQuery.mockResolvedValueOnce([[{
      organization_id: 9,
      isolation_mode: 'isolated',
      db_host: 'tenant-db',
      db_port: 3306,
      db_name: 'fireisp_org_9',
      db_user: 'tenant_user',
      db_password_encrypted: 'secret',
      ssl_enabled: 0,
    }], []]);

    const targets = await listIsolatedMigrationTargets();

    expect(targets).toEqual([{
      organizationId: 9,
      database: 'fireisp_org_9',
      connectionConfig: expect.objectContaining({
        host: 'tenant-db',
        database: 'fireisp_org_9',
        password: 'secret',
      }),
    }]);
  });
});
