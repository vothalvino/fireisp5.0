'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('migration 455 PPPoE diagnostics telemetry', () => {
  const migration = read('database/migrations/455_pppoe_diagnostics_telemetry.sql');
  const rollback = read('database/rollbacks/455_pppoe_diagnostics_telemetry.sql');
  const schema = read('database/schema.sql');

  test('adds tenant/NAS/reason ownership to radpostauth with independent rerun guards', () => {
    for (const [column, definition] of [
      ['organization_id', 'BIGINT UNSIGNED NULL'],
      ['nas_id', 'BIGINT UNSIGNED NULL'],
      ['reason_code', 'VARCHAR(50) NULL'],
    ]) {
      const guardStart = migration.indexOf(`AND COLUMN_NAME = '${column}'`);
      const addStart = migration.indexOf(`ADD COLUMN ${column} ${definition}`, guardStart);
      const guardEnd = migration.indexOf('END IF;', guardStart);
      expect(guardStart).toBeGreaterThan(-1);
      expect(addStart).toBeGreaterThan(guardStart);
      expect(addStart).toBeLessThan(guardEnd);
      expect(schema).toContain(`${column} ${definition}`);
    }

    expect(migration).toMatch(/idx_radpostauth_org_authdate \(organization_id, authdate\)/);
    expect(migration).toMatch(/idx_radpostauth_nas_id \(nas_id\)/);
    expect(migration).toMatch(/idx_radpostauth_reason_code \(reason_code\)/);
    expect(schema).toMatch(/KEY idx_radpostauth_org_authdate \(organization_id, authdate\)/);
    expect(schema).toMatch(/KEY idx_radpostauth_nas_id \(nas_id\)/);
    expect(schema).toMatch(/KEY idx_radpostauth_reason_code \(reason_code\)/);
  });

  test('adds the nullable per-NAS source dedupe key and mirrors it in schema.sql', () => {
    expect(migration).toMatch(
      /TABLE_NAME = 'pppoe_event_logs'[\s\S]*COLUMN_NAME = 'source_key'[\s\S]*ADD COLUMN source_key CHAR\(64\) NULL/,
    );
    expect(migration).toMatch(
      /ADD UNIQUE KEY uq_pppoe_event_logs_nas_source \(nas_id, source_key\)/,
    );
    expect(schema).toMatch(/source_key CHAR\(64\) NULL/);
    expect(schema).toMatch(
      /UNIQUE KEY uq_pppoe_event_logs_nas_source \(nas_id, source_key\)/,
    );
    expect(migration).toMatch(
      /ADD KEY idx_pppoe_event_logs_org_logged_at \(organization_id, logged_at\)/,
    );
    expect(schema).toMatch(
      /KEY idx_pppoe_event_logs_org_logged_at \(organization_id, logged_at\)/,
    );
  });

  test('seeds exactly one guarded global five-minute poll task with a valid priority', () => {
    expect(migration).toMatch(/'poll_pppoe_events'/);
    expect(migration).toMatch(/'\*\/5 \* \* \* \*'/);
    expect(migration).toMatch(/'normal'/);
    expect(migration).toMatch(
      /WHERE NOT EXISTS \([\s\S]*task_name = 'poll_pppoe_events'[\s\S]*organization_id IS NULL/,
    );
    expect(schema).toMatch(/'poll_pppoe_events'[\s\S]*'\*\/5 \* \* \* \*'/);
    expect(migration).toMatch(/priority, timeout_seconds\)[\s\S]*'normal',\s*3600/);
    expect(schema).toMatch(/priority, timeout_seconds\)[\s\S]*'normal',\s*3600/);
    expect(migration).toMatch(/does not enforce this value as a hard execution deadline/);
    expect(schema).toMatch(/operational metadata, not a hard runner deadline/);
    expect(schema).toMatch(/Runtime\/stuck threshold metadata in seconds; enforcement is handler-specific/);
  });

  test('rollback removes indexes before their columns and deletes only the global task', () => {
    expect(rollback).toMatch(
      /DELETE FROM scheduled_tasks[\s\S]*task_name = 'poll_pppoe_events'[\s\S]*organization_id IS NULL/,
    );

    const uniqueDrop = rollback.indexOf('DROP INDEX uq_pppoe_event_logs_nas_source');
    const sourceDrop = rollback.indexOf('DROP COLUMN source_key');
    const orgIndexDrop = rollback.indexOf('DROP INDEX idx_radpostauth_org_authdate');
    const orgColumnDrop = rollback.indexOf('DROP COLUMN organization_id');
    expect(uniqueDrop).toBeGreaterThan(-1);
    expect(uniqueDrop).toBeLessThan(sourceDrop);
    expect(orgIndexDrop).toBeGreaterThan(-1);
    expect(orgIndexDrop).toBeLessThan(orgColumnDrop);
    expect(rollback.match(/INFORMATION_SCHEMA\.(?:COLUMNS|STATISTICS)/g)).toHaveLength(9);
  });
});
