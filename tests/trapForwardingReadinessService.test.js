'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

const db = require('../src/config/database');
const readiness = require('../src/services/trapForwardingReadinessService');

function installReadyPrimary({ isolated = [], organizations = [10] } = {}) {
  db.query.mockImplementation(async (sql, params = []) => {
    if (/FROM schema_migrations/.test(sql)) {
      expect(params).toEqual(['459_activate_snmp_trap_forwarding.sql']);
      return [[{ filename: params[0] }]];
    }
    if (/FROM information_schema\.columns/.test(sql)) {
      return [[{ required_columns: 27 }]];
    }
    if (/FROM organization_database_configs odc/.test(sql)) {
      return [isolated.map(organization_id => ({ organization_id }))];
    }
    if (/FROM organizations/.test(sql)) {
      return [organizations.map(id => ({ id }))];
    }
    throw new Error(`Unexpected readiness SQL: ${sql}`);
  });
}

describe('trapForwardingReadinessService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readiness.invalidateSchemaReadinessCache();
    db.withPrimaryContext.mockImplementation(callback => callback());
  });

  test('requires migration 459 before the listener can become ready', async () => {
    db.query.mockResolvedValueOnce([[]]);

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toMatchObject({
      ready: false,
      primary: { ready: false, reason: 'primary_schema_unavailable' },
      isolated: [],
      reason: 'primary_schema_unavailable',
      checked_at: expect.any(String),
    });
    expect(db.query.mock.calls.some(([sql]) => /information_schema\.columns/.test(sql))).toBe(false);
  });

  test('verifies the exact forwarding columns rather than trusting only migration history', async () => {
    db.query
      .mockResolvedValueOnce([[{ filename: readiness.MIGRATION_FILENAME }]])
      .mockResolvedValueOnce([[{ required_columns: 17 }]]);

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toMatchObject({
      ready: false,
      primary: { ready: false, reason: 'primary_schema_unavailable' },
      reason: 'primary_schema_unavailable',
    });
  });

  test('is ready for attribution only in a migrated shared-only installation', async () => {
    installReadyPrimary();

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toMatchObject({
      ready: true,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: null,
      checked_at: expect.any(String),
    });
    const schemaQuery = db.query.mock.calls.find(
      ([sql]) => /FROM information_schema\.columns/.test(sql),
    );
    expect(schemaQuery[0]).toMatch(/table_name = 'snmp_trap_ingest_daily_usage'/);
    expect(schemaQuery[0]).toMatch(/table_name = 'snmp_traps'/);
    for (const column of [
      'varbinds_truncated',
      'varbinds_original_count',
      'varbinds_truncation_reason',
    ]) {
      expect(schemaQuery[0]).toContain(`'${column}'`);
    }
    expect(schemaQuery[0]).toContain("'organization_epoch'");
    expect(schemaQuery[0]).toContain("'outbound_delivery_epoch'");
    expect(schemaQuery[0].match(/'revoked_at'/g)).toHaveLength(2);
    for (const column of [
      'usage_date',
      'scope_type',
      'scope_id',
      'trap_count',
      'varbind_bytes',
      'delivery_count',
      'metadata_only_count',
      'dropped_trap_count',
      'forwarding_skipped_count',
    ]) {
      expect(schemaQuery[0]).toContain(`'${column}'`);
    }
  });

  test('returns one stable fail-closed reason for every retained isolated database config', async () => {
    installReadyPrimary({ isolated: [22, 33] });

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toEqual({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [
        {
          organization_id: 22,
          ready: false,
          reason: 'isolated_tenant_attribution_unsupported',
        },
        {
          organization_id: 33,
          ready: false,
          reason: 'isolated_tenant_attribution_unsupported',
        },
      ],
      reason: 'isolated_tenant_attribution_unsupported',
      checked_at: expect.any(String),
    });
    const isolationQuery = db.query.mock.calls.find(
      ([sql]) => /FROM organization_database_configs odc/.test(sql),
    );
    expect(isolationQuery[0]).toMatch(/odc\.isolation_mode = 'isolated'/);
    expect(isolationQuery[0]).not.toMatch(/JOIN organizations|o\.status|o\.deleted_at/);
  });

  test('fails closed when more than one organization is retained regardless of lifecycle status', async () => {
    installReadyPrimary({ organizations: [10, 11] });

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toMatchObject({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: 'multi_organization_attribution_unsupported',
    });
    const organizationQuery = db.query.mock.calls.find(
      ([sql]) => /FROM organizations/.test(sql),
    );
    expect(organizationQuery[0]).toMatch(/ORDER BY id LIMIT 2/);
    expect(organizationQuery[0]).not.toMatch(/status|deleted_at/);
  });

  test('zero retained organizations keeps listener readiness available without inventing an owner', async () => {
    installReadyPrimary({ organizations: [] });

    await expect(readiness.checkSchemaReadiness({ force: true })).resolves.toMatchObject({
      ready: true,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: null,
    });
  });

  test('database errors fail closed without leaking connection details', async () => {
    db.query.mockRejectedValueOnce(new Error('password=do-not-expose host=private-db'));

    const result = await readiness.checkSchemaReadiness({ force: true });

    expect(result).toMatchObject({
      ready: false,
      primary: { ready: false, reason: 'primary_schema_unavailable' },
      reason: 'primary_schema_unavailable',
    });
    expect(JSON.stringify(result)).not.toMatch(/password|private-db/);
  });
});
