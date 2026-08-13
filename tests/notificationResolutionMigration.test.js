'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('migration 453 notification resolution state', () => {
  it('mirrors restart-safe resolved_at columns and selective indexes in the canonical schema', () => {
    const migration = read('database/migrations/453_notification_resolution_state.sql');
    const schema = read('database/schema.sql');
    expect(migration).toMatch(/TABLE_NAME = 'notifications'[\s\S]*COLUMN_NAME = 'resolved_at'/);
    expect(migration).toMatch(/TABLE_NAME = 'ops_alert_deliveries'[\s\S]*COLUMN_NAME = 'resolved_at'/);
    expect(migration).toMatch(
      /ADD KEY idx_notifications_entity_resolution \(entity_type, resolved_at, deleted_at\)/,
    );
    expect(migration).toMatch(/idx_ops_alert_deliveries_resolved_at/);
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS notifications[\s\S]*resolved_at DATETIME/);
    expect(schema).toMatch(
      /KEY idx_notifications_entity_resolution \(entity_type, resolved_at, deleted_at\)/,
    );
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS ops_alert_deliveries[\s\S]*resolved_at DATETIME/);
    expect(migration).not.toMatch(/ADD KEY idx_notifications_resolved_at \(resolved_at\)/);
    expect(schema).not.toMatch(/KEY idx_notifications_resolved_at \(resolved_at\)/);
  });

  it('has a guarded rollback for both tables', () => {
    const rollback = read('database/rollbacks/453_notification_resolution_state.sql');
    expect(rollback).toMatch(
      /ALTER TABLE notifications DROP INDEX idx_notifications_entity_resolution/,
    );
    expect(rollback).toMatch(/ALTER TABLE notifications DROP COLUMN resolved_at/);
    expect(rollback).toMatch(/ALTER TABLE ops_alert_deliveries DROP COLUMN resolved_at/);
    expect(rollback.match(/INFORMATION_SCHEMA\.COLUMNS/g)).toHaveLength(2);
  });
});
