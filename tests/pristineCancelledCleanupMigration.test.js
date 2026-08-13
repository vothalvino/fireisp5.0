'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read(
  'database/migrations/454_repair_pristine_cancelled_cleanup_markers.sql',
);

describe('migration 454 pristine cancelled cleanup repair', () => {
  test('is bounded to post-450, never-activated cancelled PPPoE installations', () => {
    expect(migration).toMatch(
      /JOIN schema_migrations migration_450[\s\S]*migration_450\.filename = '450_commissioning_evidence_and_test_cleanup\.sql'[\s\S]*c\.created_at >= migration_450\.applied_at/,
    );
    expect(migration).toMatch(/c\.status = 'cancelled'/);
    expect(migration).toMatch(/c\.connection_type IN \('pppoe', 'pppoe_dual'\)/);
    expect(migration).toMatch(/c\.first_activated_at IS NULL/);
    expect(migration).toMatch(/c\.test_window_expires_at IS NULL/);
    expect(migration).toMatch(/c\.test_window_cleanup_pending = 1/);
    expect(migration).toMatch(/c\.test_window_cleanup_attempted_at IS NOT NULL/);
    expect(migration).toMatch(
      /EXISTS \([\s\S]*FROM service_orders so[\s\S]*so\.contract_id = c\.id[\s\S]*so\.order_type = 'new_install'[\s\S]*so\.status = 'cancelled'[\s\S]*\)/,
    );
  });

  test('fails closed on every external authentication or session signal', () => {
    expect(migration).toMatch(
      /AND 1 = \(\s*SELECT COUNT\(\*\)\s*FROM radius live_radius\s*WHERE live_radius\.contract_id = c\.id\s*AND live_radius\.deleted_at IS NULL\s*\)/,
    );
    expect(migration).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1\s*FROM radius archived_radius\s*WHERE archived_radius\.contract_id = c\.id\s*AND archived_radius\.deleted_at IS NOT NULL\s*\)/,
    );
    expect(migration).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1\s*FROM radius r\s*WHERE r\.contract_id = c\.id\s*AND r\.deleted_at IS NULL/,
    );
    expect(migration).toMatch(/COALESCE\(r\.status, ''\) <> 'inactive'/);
    expect(migration).toMatch(/r\.nas_id IS NOT NULL/);
    expect(migration).toMatch(/NULLIF\(TRIM\(r\.username\), ''\) IS NULL/);
    expect(migration).toMatch(/FROM radcheck rc WHERE rc\.username = r\.username/);
    expect(migration).toMatch(/FROM radreply rr WHERE rr\.username = r\.username/);
    expect(migration).toMatch(/FROM radusergroup rug WHERE rug\.username = r\.username/);
    expect(migration).toMatch(
      /FROM connection_logs cl[\s\S]*cl\.contract_id = c\.id[\s\S]*cl\.event_type IN \('start', 'interim-update'\)[\s\S]*cl\.session_id IS NULL[\s\S]*stopped\.session_id = cl\.session_id[\s\S]*stopped\.event_type = 'stop'[\s\S]*stopped\.event_at >= cl\.event_at/,
    );
    expect(migration).not.toMatch(/stopped\.session_id <=> cl\.session_id/);
  });

  test('only clears the two false marker fields and is rerun-safe', () => {
    expect(migration.match(/UPDATE contracts c/g)).toHaveLength(1);
    expect(migration).toMatch(
      /SET c\.test_window_cleanup_pending = 0,\s*c\.test_window_cleanup_attempted_at = NULL/,
    );
    expect(migration).not.toMatch(/\b(?:ALTER|CREATE|DROP|DELETE|INSERT)\b\s+(?:TABLE|FROM|INTO)/i);
    expect(migration).not.toMatch(/SET[\s\S]*test_window_expires_at\s*=/);
  });

  test('ships a non-repoisoning rollback for the irreversible data correction', () => {
    const rollback = read(
      'database/rollbacks/454_repair_pristine_cancelled_cleanup_markers.sql',
    );
    expect(rollback).toMatch(/SELECT 1 AS pristine_cancelled_cleanup_repair_preserved/);
    expect(rollback).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE|DROP)\b/i);
  });
});
