// =============================================================================
// FireISP 5.0 — Data Retention Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(),
  withTenantContext: jest.fn(),
}));

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const retentionService = require('../src/services/retentionService');

const ISOLATED_DATABASE_QUERY = 'FROM organization_database_configs odc';

function mockGlobalQueries(isolatedOrganizationIds = []) {
  db.query.mockImplementation(sql => {
    if (sql.includes(ISOLATED_DATABASE_QUERY)) {
      return Promise.resolve([
        isolatedOrganizationIds.map(organizationId => ({
          organization_id: organizationId,
        })),
      ]);
    }
    return Promise.resolve([{ affectedRows: 0 }]);
  });
}

describe('retentionService', () => {
  function clearRetentionEnvironment() {
    for (const table of Object.keys(retentionService.DEFAULT_POLICIES)) {
      delete process.env[`RETENTION_${table.toUpperCase()}_DAYS`];
    }
  }

  beforeEach(() => {
    jest.resetAllMocks();
    db.withPrimaryContext.mockImplementation(callback => callback());
    db.withTenantContext.mockImplementation((_organizationId, callback) => callback());
    clearRetentionEnvironment();
  });

  afterEach(() => {
    clearRetentionEnvironment();
  });

  describe('loadPolicies()', () => {
    test('returns default retention days, including PPPoE telemetry', () => {
      const policies = retentionService.loadPolicies();
      expect(policies).toEqual({
        audit_logs: 365,
        alert_events: 90,
        webhook_deliveries: 90,
        email_logs: 180,
        sms_logs: 180,
        idempotency_keys: 7,
        radpostauth: 90,
        pppoe_event_logs: 90,
      });
    });

    test('overrides PPPoE telemetry retention from environment variables', () => {
      process.env.RETENTION_RADPOSTAUTH_DAYS = '120';
      process.env.RETENTION_PPPOE_EVENT_LOGS_DAYS = '45';

      const policies = retentionService.loadPolicies();
      expect(policies.radpostauth).toBe(120);
      expect(policies.pppoe_event_logs).toBe(45);
    });

    test.each(['0', '-1', 'not-a-number', '30days', '1.5'])(
      'falls back safely for invalid retention value %p',
      value => {
        process.env.RETENTION_RADPOSTAUTH_DAYS = value;

        const policies = retentionService.loadPolicies();

        expect(policies.radpostauth).toBe(90);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            envKey: 'RETENTION_RADPOSTAUTH_DAYS',
            defaultDays: 90,
          }),
          'Invalid retention period; using safe default',
        );
      },
    );
  });

  describe('purgeTable()', () => {
    test('deletes old records in 1,000-row batches', async () => {
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1000 }])
        .mockResolvedValueOnce([{ affectedRows: 500 }]);

      const result = await retentionService.purgeTable('audit_logs', 365);

      expect(result).toEqual({ table: 'audit_logs', deleted: 1500 });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[0][0]).toContain('LIMIT 1000');
    });

    test('handles zero rows to delete', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const result = await retentionService.purgeTable('alert_events', 90);

      expect(result).toEqual({ table: 'alert_events', deleted: 0 });
    });

    test('uses authdate and logged_at for the telemetry tables', async () => {
      db.query.mockResolvedValue([{ affectedRows: 0 }]);

      await retentionService.purgeTable('radpostauth', 90);
      await retentionService.purgeTable('pppoe_event_logs', 90);

      expect(db.query.mock.calls[0][0]).toContain('`authdate`');
      expect(db.query.mock.calls[1][0]).toContain('`logged_at`');
    });

    test('rejects unknown tables and unapproved date columns', async () => {
      await expect(retentionService.purgeTable('users', 30))
        .rejects.toThrow('not in the retention policy whitelist');
      await expect(retentionService.purgeTable('radpostauth', 90, 'created_at'))
        .rejects.toThrow('is not valid for retention table');
      expect(db.query).not.toHaveBeenCalled();
    });

    test.each([0, -1, 1.5, '7days'])(
      'rejects unsafe direct retention period %p',
      async retentionDays => {
        await expect(retentionService.purgeTable('radpostauth', retentionDays))
          .rejects.toThrow('retentionDays must be a positive integer');
        expect(db.query).not.toHaveBeenCalled();
      },
    );
  });

  describe('runAll()', () => {
    test('runs every configured policy against the primary database', async () => {
      mockGlobalQueries();

      const result = await retentionService.runAll();

      expect(result.tables).toHaveLength(8);
      expect(result.total_deleted).toBe(0);
      expect(result.database_scopes).toEqual([
        expect.objectContaining({
          database_scope: 'primary',
          organization_id: null,
          tables: 8,
          status: 'ok',
        }),
      ]);
      expect(db.withPrimaryContext).toHaveBeenCalledTimes(2);
      expect(db.withTenantContext).not.toHaveBeenCalled();
      expect(db.query.mock.calls[0][0]).toContain("o.status = 'active'");
      expect(db.query.mock.calls[0][0]).toContain('o.deleted_at IS NULL');
    });

    test('continues on error for an individual table', async () => {
      let deleteCalls = 0;
      db.query.mockImplementation(sql => {
        if (sql.includes(ISOLATED_DATABASE_QUERY)) return Promise.resolve([[]]);
        deleteCalls += 1;
        if (deleteCalls === 1) return Promise.reject(new Error('Table not found'));
        return Promise.resolve([{ affectedRows: 0 }]);
      });

      const result = await retentionService.runAll();

      expect(result.tables).toHaveLength(8);
      expect(result.tables.find(table => table.error)).toEqual(
        expect.objectContaining({ error: 'Table not found', database_scope: 'primary' }),
      );
      expect(result.database_scopes[0]).toEqual(
        expect.objectContaining({ status: 'partial', table_errors: 1 }),
      );
    });

    test('reports total deleted count across tables', async () => {
      let deleteCalls = 0;
      db.query.mockImplementation(sql => {
        if (sql.includes(ISOLATED_DATABASE_QUERY)) return Promise.resolve([[]]);
        deleteCalls += 1;
        return Promise.resolve([{ affectedRows: deleteCalls === 1 ? 50 : 0 }]);
      });

      const result = await retentionService.runAll();

      expect(result.total_deleted).toBe(50);
    });

    test('fans out to every active isolated tenant database', async () => {
      mockGlobalQueries([11, 22]);

      const result = await retentionService.runAll();

      expect(db.withTenantContext).toHaveBeenNthCalledWith(1, 11, expect.any(Function));
      expect(db.withTenantContext).toHaveBeenNthCalledWith(2, 22, expect.any(Function));
      expect(result.tables).toHaveLength(24);
      expect(result.tables.filter(table => table.database_scope === 'isolated')).toHaveLength(16);
      expect(result.database_scopes).toEqual([
        expect.objectContaining({ database_scope: 'primary', status: 'ok' }),
        expect.objectContaining({ database_scope: 'isolated', organization_id: 11, status: 'ok' }),
        expect.objectContaining({ database_scope: 'isolated', organization_id: 22, status: 'ok' }),
      ]);
      expect(result.scope_failures).toEqual([]);

      const isolatedDeletes = db.query.mock.calls.filter(
        ([sql, params]) => sql.startsWith('DELETE') && params.length === 2,
      );
      expect(isolatedDeletes).toHaveLength(16);
      expect(isolatedDeletes.every(([, params]) => [11, 22].includes(params[1]))).toBe(true);
    });

    test('isolates a failed tenant scope and continues with later tenants', async () => {
      mockGlobalQueries([11, 22]);
      db.withTenantContext.mockImplementation((organizationId, callback) => {
        if (organizationId === 11) return Promise.reject(new Error('Tenant DB offline'));
        return callback();
      });

      const result = await retentionService.runAll();

      expect(db.withTenantContext).toHaveBeenCalledTimes(2);
      expect(result.tables).toHaveLength(16);
      expect(result.tables.filter(table => table.organization_id === 22)).toHaveLength(8);
      expect(result.scope_failures).toEqual([
        {
          database_scope: 'isolated',
          organization_id: 11,
          error: 'Tenant DB offline',
        },
      ]);
    });

    test('keeps tenant-triggered retention strictly organization-scoped', async () => {
      db.query.mockResolvedValue([{ affectedRows: 0 }]);

      const result = await retentionService.runAll({ organizationId: '42' });

      expect(db.withTenantContext).toHaveBeenCalledWith(42, expect.any(Function));
      expect(db.withPrimaryContext).not.toHaveBeenCalled();
      expect(result.tables).toHaveLength(8);
      expect(result.tables.every(table => table.organization_id === 42)).toBe(true);

      for (const [sql, params] of db.query.mock.calls) {
        expect(sql).toContain('`organization_id` = ?');
        expect(params[params.length - 1]).toBe(42);
      }
      const webhookDelete = db.query.mock.calls.find(([sql]) => sql.includes('`webhook_deliveries`'));
      expect(webhookDelete[0]).toContain('SELECT `id` FROM `webhooks`');
    });

    test('fails closed for an invalid tenant organization ID', async () => {
      await expect(retentionService.runAll({ organizationId: 0 }))
        .rejects.toThrow('organizationId must be a positive integer');
      expect(db.query).not.toHaveBeenCalled();
      expect(db.withTenantContext).not.toHaveBeenCalled();
    });
  });
});
