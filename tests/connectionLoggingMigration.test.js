const fs = require('node:fs');
const path = require('node:path');
const { splitStatements } = require('../src/scripts/migrate');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('database/migrations/457_connection_logging_compliance.sql');
const rollback = read('database/rollbacks/457_connection_logging_compliance.sql');
const schema = read('database/schema.sql');

describe('migration 457 connection logging contract', () => {
  test('has no comment-only migration statements', () => {
    const statements = splitStatements(migration);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const executable = statement
        .replace(/^\s*--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      expect(executable).not.toBe('');
    }
  });

  test('creates the evidence sink before ALTER and installs all live-write triggers before backfill', () => {
    const tableAt = migration.indexOf('CREATE TABLE IF NOT EXISTS radius_accounting_events');
    const alterAt = migration.indexOf('CALL migration_457_connection_log_org()');
    const ownerTriggerAt = migration.indexOf('CREATE TRIGGER trg_connection_logs_before_insert_org');
    const insertTriggerAt = migration.indexOf('CREATE TRIGGER trg_connection_logs_after_insert_evidence');
    const updateTriggerAt = migration.indexOf('CREATE TRIGGER trg_connection_logs_after_update_evidence');
    const backfillAt = migration.indexOf('UPDATE connection_logs cl');

    expect(tableAt).toBeGreaterThan(0);
    expect(tableAt).toBeLessThan(alterAt);
    expect(alterAt).toBeLessThan(ownerTriggerAt);
    expect(ownerTriggerAt).toBeLessThan(insertTriggerAt);
    expect(insertTriggerAt).toBeLessThan(updateTriggerAt);
    expect(updateTriggerAt).toBeLessThan(backfillAt);
    expect(migration).toMatch(/briefly pause[\s\S]*accounting writes/i);
  });

  test('declares each evidence trigger and client-time index exactly once', () => {
    expect((migration.match(/CREATE TRIGGER trg_connection_logs_before_insert_org/g) || [])).toHaveLength(1);
    expect((migration.match(/CREATE TRIGGER trg_connection_logs_after_insert_evidence/g) || [])).toHaveLength(1);
    expect((migration.match(/CREATE TRIGGER trg_connection_logs_after_update_evidence/g) || [])).toHaveLength(1);
    expect((migration.match(/KEY idx_radius_events_client_time/g) || [])).toHaveLength(1);

    for (const source of [migration, schema]) {
      for (const triggerName of [
        'trg_connection_logs_after_insert_evidence',
        'trg_connection_logs_after_update_evidence',
      ]) {
        const body = source.match(new RegExp(
          `CREATE TRIGGER ${triggerName}[\\s\\S]*?END\\s*(?://|\\$\\$)`,
        ))?.[0];
        expect(body).toBeDefined();
        const declarations = [...body.matchAll(/DECLARE\s+([a-z_][a-z0-9_]*)/gi)]
          .map(match => match[1].toLowerCase());
        expect(new Set(declarations).size).toBe(declarations.length);
      }
    }
  });

  test('uses bounded milestone evidence and unambiguous canonical hashing', () => {
    expect(migration).toMatch(/v_is_milestone = NEW\.session_instance_id IS NOT NULL[\s\S]*NEW\.event_type IN \('start', 'stop'\)/);
    expect(migration).toMatch(/JSON_ARRAY\([\s\S]*NEW\.organization_id[\s\S]*NEW\.nas_id[\s\S]*NEW\.username[\s\S]*NEW\.session_instance_id/);
    expect(migration).toMatch(/NEW\.framed_ipv6_prefix/);
    expect(migration).toMatch(/NEW\.terminate_cause/);
    expect(migration).toMatch(/ON DUPLICATE KEY UPDATE id = id/);
    expect(migration).not.toMatch(/INSERT IGNORE INTO radius_accounting_events/);
  });

  test('has case-sensitive collector replay identity and future-safe partition maintenance', () => {
    expect(migration).toMatch(/exporter_id\s+VARCHAR\(191\)[^\n]*ascii_bin/);
    expect(migration).toMatch(/event_id\s+VARCHAR\(191\)[^\n]*ascii_bin/);
    expect(migration).toContain('UNIQUE KEY uq_cgnat_event_replay (organization_id, exporter_config_id, exporter_boot_id, event_id)');
    expect(migration).toMatch(/evt_subscriber_logging_partition_maintenance[\s\S]*STARTS \(CURRENT_DATE \+ INTERVAL 1 DAY \+ INTERVAL 3 HOUR\)[\s\S]*ON COMPLETION PRESERVE/);
  });

  test('coerces fractional RADIUS timestamps to an integer partition expression', () => {
    for (const source of [migration, schema]) {
      const table = source.match(
        /CREATE TABLE IF NOT EXISTS radius_accounting_events \([\s\S]*?PARTITION p_future\s+VALUES LESS THAN MAXVALUE\s*\n\);/,
      )?.[0];
      expect(table).toBeDefined();
      expect(table).toContain('event_at               TIMESTAMP(3)');
      expect(table).toContain('PRIMARY KEY (id, event_at)');
      expect(table).toContain('PARTITION BY RANGE (FLOOR(UNIX_TIMESTAMP(event_at)))');
      expect(table).not.toContain('PARTITION BY RANGE (UNIX_TIMESTAMP(event_at))');
      expect(source).toMatch(/CREATE PROCEDURE subscriber_logging_maintain_partitions\(\)[\s\S]*v_next_ts = UNIX_TIMESTAMP/);
    }
  });

  test('adds bounded usage/provenance storage and indexable retention timestamps', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS radius_accounting_usage_daily');
    expect(migration).toContain('KEY idx_radius_usage_date (usage_date)');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS collector_ingest_receipts');
    expect(migration).toContain('UNIQUE KEY uq_collector_receipt_bucket');
    expect(migration).toContain('ADD KEY idx_conn_logs_retention (retention_at)');
    expect(migration).toContain('ADD KEY idx_conn_logs_org_retention (organization_id, retention_at)');
    expect(migration).toMatch(/INSERT INTO scheduled_tasks[\s\S]*purge_radius_accounting[\s\S]*WHERE NOT EXISTS/);
    expect(schema).toMatch(/INSERT INTO scheduled_tasks[\s\S]*purge_radius_accounting[\s\S]*configured calendar-month retention/);
  });

  test('adds stable API-token provenance to sensitive report access records', () => {
    expect(migration).toMatch(/ALTER TABLE report_access_logs ADD COLUMN api_token_id/);
    expect(migration).toContain('idx_report_access_logs_api_token');
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS report_access_logs[\s\S]*api_token_id[\s\S]*idx_report_access_logs_api_token/);
    expect(rollback).toMatch(/report_access_logs API-token\/government-request provenance[\s\S]*retained[\s\S]*intentionally/i);
    expect(rollback).not.toMatch(/ALTER TABLE report_access_logs DROP COLUMN api_token_id/);
  });

  test('grants sensitive permissions only to live roles and preserves unowned RBAC rows on rollback', () => {
    expect(migration).toMatch(/INSERT INTO role_permissions[\s\S]*connection_logs\.ingest[\s\S]*WHERE r\.name IN \('admin', 'super_admin'\)[\s\S]*AND r\.deleted_at IS NULL/);
    expect(migration).toMatch(/INSERT INTO role_permissions[\s\S]*ip_attribution\.export[\s\S]*WHERE r\.name IN \('admin', 'super_admin'\)/);
    expect(migration).toMatch(/gov_data_requests\.view[\s\S]*WHERE r\.name = 'super_admin'/);
    expect(migration).toMatch(/INSERT INTO role_permissions[\s\S]*connection_logs\.export[\s\S]*WHERE r\.name = 'auditor'[\s\S]*AND r\.deleted_at IS NULL/);
    expect(schema).toMatch(/INSERT IGNORE INTO role_permissions[\s\S]*connection_logs\.ingest[\s\S]*WHERE r\.name IN \('admin', 'super_admin'\)\s+AND r\.deleted_at IS NULL;/);
    expect(schema).toMatch(/INSERT IGNORE INTO role_permissions[\s\S]*connection_logs\.export[\s\S]*WHERE r\.name = 'auditor'\s+AND r\.deleted_at IS NULL;/);
    expect(rollback).toMatch(/Permission definitions and grants are retained/i);
    expect(rollback).not.toMatch(/DELETE FROM permissions/);
    expect(rollback).not.toMatch(/DELETE rp\s+FROM role_permissions/);
  });

  test('does not weaken source-only FreeRADIUS/SNMP business-key uniqueness in shared databases', () => {
    expect(schema).toContain('UNIQUE KEY uq_nas_ip_address (ip_address, active_flag)');
    expect(schema).toContain('UNIQUE KEY uq_radius_username (username, active_flag)');
    expect(migration).not.toContain('organization_unique_scope');
  });

  test('rollback drops 457 objects and deliberately restores the destructive pre-457 partition routine', () => {
    for (const table of [
      'ip_attribution_case_evidence', 'cgnat_binding_events',
      'cgnat_attribution_bindings', 'cgnat_exporter_configs',
      'collector_ingest_receipts',
      'radius_accounting_usage_daily', 'radius_accounting_events',
    ]) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
    expect(rollback).toMatch(/CREATE PROCEDURE connection_logs_maintain_partitions\(\)[\s\S]*INTERVAL 2 YEAR/);
    expect(rollback).toMatch(/CREATE EVENT evt_connection_logs_partition_maintenance[\s\S]*drop expired \(2-year retention\)/);
    expect(rollback).toMatch(/default 12/);
    expect(rollback).toMatch(/security backfill[\s\S]*intentionally not reversed/i);
  });

  test('fresh schema mirrors the new tables, trigger semantics, and safe partition schedule', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS radius_accounting_events');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS cgnat_attribution_bindings');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS cgnat_binding_events');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS ip_attribution_case_evidence');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS radius_accounting_usage_daily');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS collector_ingest_receipts');
    expect(schema).toContain('CREATE TRIGGER trg_connection_logs_after_update_evidence');
    expect(schema).toMatch(/DROP PROCEDURE IF EXISTS connection_logs_maintain_partitions;[\s\S]*CREATE PROCEDURE connection_logs_maintain_partitions\(\)[\s\S]*CALL connection_logs_maintain_partitions\(\);[\s\S]*CREATE EVENT IF NOT EXISTS evt_connection_logs_partition_maintenance/);
    expect(schema).toMatch(/evt_subscriber_logging_partition_maintenance[\s\S]*STARTS \(CURRENT_DATE \+ INTERVAL 1 DAY \+ INTERVAL 3 HOUR\)/);
    expect(schema).toMatch(/consistency marker; not tamper-proof/i);
  });

  test('pins the RADIUS chain, corrected clock horizon, and one collector token per epoch', () => {
    expect(migration).toContain('ADD COLUMN attribution_evidence_complete');
    expect(migration).toContain('ADD COLUMN attribution_anomaly_reason');
    expect(migration).toContain('radius_evidence_integrity_hash');
    expect(migration).toContain('radius_evidence_observed_at');
    expect(migration).toContain('last_corrected_device_at');
    expect(migration).toContain('coverage_horizon_at');
    expect(migration).toContain('recovery_collector_api_token_id');
    expect(migration).toContain('UNIQUE KEY uq_cgnat_exporter_collector_token');
    expect(migration).toContain('UNIQUE KEY uq_cgnat_exporter_recovery_token');
    expect(migration).toMatch(/NEW\.calling_station_id <=> OLD\.calling_station_id/);
    expect(migration).toMatch(/FOREIGN KEY \(binding_id, organization_id\)[\s\S]*ON DELETE CASCADE/);
  });
});
