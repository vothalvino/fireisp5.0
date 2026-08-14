'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('migration 456 NAS maintenance mode', () => {
  const migration = read('database/migrations/456_nas_maintenance_mode.sql');
  const rollback = read('database/rollbacks/456_nas_maintenance_mode.sql');
  const schema = read('database/schema.sql');

  test('adds a guarded, backwards-compatible maintenance flag', () => {
    expect(migration).toMatch(
      /TABLE_NAME = 'nas'[\s\S]*COLUMN_NAME = 'maintenance_mode'[\s\S]*ADD COLUMN maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE/,
    );
    expect(migration).toMatch(/AFTER access_mode/);
    expect(schema).toMatch(/maintenance_mode BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  });

  test('ships an independently guarded rollback', () => {
    expect(rollback).toMatch(
      /TABLE_NAME = 'nas'[\s\S]*COLUMN_NAME = 'maintenance_mode'[\s\S]*ALTER TABLE nas DROP COLUMN maintenance_mode/,
    );
  });
});
