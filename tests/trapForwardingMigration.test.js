'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function deliveryDefinition(source) {
  const match = source.match(
    /CREATE TABLE (?:IF NOT EXISTS )?snmp_trap_forwarding_deliveries \([\s\S]*?\n\) ENGINE=InnoDB/,
  );
  expect(match).toBeDefined();
  return match[0];
}

function usageDefinition(source) {
  const match = source.match(
    /CREATE TABLE (?:IF NOT EXISTS )?snmp_trap_ingest_daily_usage \([\s\S]*?\n\) ENGINE=InnoDB/,
  );
  expect(match).toBeDefined();
  return match[0];
}

describe('migration 459 durable SNMP trap forwarding', () => {
  const migration = read('database/migrations/459_activate_snmp_trap_forwarding.sql');
  const rollback = read('database/rollbacks/459_activate_snmp_trap_forwarding.sql');
  const schema = read('database/schema.sql');

  test('pauses every pre-existing rule before forwarding is activated', () => {
    const pauseAt = migration.indexOf('UPDATE snmp_trap_forwarding_rules');
    const deliveriesAt = migration.search(
      /CREATE TABLE (?:IF NOT EXISTS )?snmp_trap_forwarding_deliveries/,
    );

    expect(pauseAt).toBeGreaterThan(-1);
    expect(pauseAt).toBeLessThan(deliveriesAt);
    expect(migration.slice(pauseAt, deliveriesAt)).toMatch(
      /SET is_active = FALSE,\s*configuration_reviewed_at = NULL/,
    );
  });

  test('rolling-upgrade writers cannot make stale or unreviewed rules eligible to forward', () => {
    for (const source of [migration, schema]) {
      expect(source).toMatch(
        /configuration_reviewed_at\s+DATETIME\s+NULL[\s\S]*?secure (?:API )?validator/i,
      );
      const trigger = source.match(
        /CREATE TRIGGER trg_stfr_clear_review_bu[\s\S]*?BEFORE UPDATE ON snmp_trap_forwarding_rules[\s\S]*?END\$\$/,
      );
      expect(trigger).toBeDefined();
      for (const field of [
        'match_trap_type',
        'match_source_ip',
        'match_oid_prefix',
        'forward_to_url',
        'forward_to_email',
      ]) {
        expect(trigger[0]).toMatch(
          new RegExp(`BINARY\\s+NEW\\.${field}\\s+<=>\\s+BINARY\\s+OLD\\.${field}`),
        );
      }
      for (const field of ['forward_to_webhook_id', 'is_active']) {
        expect(trigger[0]).toMatch(
          new RegExp(`NEW\\.${field}\\s+<=>\\s+OLD\\.${field}`),
        );
      }
      expect(trigger[0]).toMatch(/SET NEW\.configuration_reviewed_at = NULL/);
    }

    const service = read('src/services/trapForwardingService.js');
    expect(service).toMatch(
      /WHERE organization_id = \? AND is_active = 1 AND deleted_at IS NULL\s+AND configuration_reviewed_at IS NOT NULL/,
    );
  });

  test('treats URL capability tokens as binary identities in webhook mutation triggers', () => {
    for (const source of [migration, schema]) {
      const trigger = source.match(
        /CREATE TRIGGER trg_webhooks_cancel_trap_unclaimed_bu[\s\S]*?AFTER UPDATE ON webhooks[\s\S]*?END\$\$/,
      );
      expect(trigger).toBeDefined();
      expect(trigger[0]).toMatch(
        /NOT \(BINARY NEW\.url <=> BINARY OLD\.url\)/,
      );
      expect(trigger[0]).toMatch(/UPDATE snmp_trap_forwarding_deliveries/);
      expect(trigger[0]).toMatch(/UPDATE webhook_deliveries/);
    }
  });

  test('creates tenant-owned durable outcomes with bounded retry state', () => {
    for (const source of [migration, schema]) {
      const definition = deliveryDefinition(source);
      expect(definition).toMatch(/organization_id\s+BIGINT UNSIGNED NOT NULL/);
      expect(definition).toMatch(
        /status\s+ENUM\('pending','processing','retrying','success','dead_letter','cancelled'\)/,
      );
      expect(definition).toMatch(/attempt_number\s+TINYINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/max_attempts\s+TINYINT UNSIGNED NOT NULL DEFAULT 4/);
      expect(definition).toMatch(/recovery_count\s+TINYINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/claim_token\s+CHAR\(36\)\s+NULL/);
      expect(definition).toMatch(/UNIQUE KEY uq_stfd_rule_trap \(organization_id, rule_id, trap_id\)/);
      expect(definition).toMatch(/KEY idx_stfd_due \(status, next_attempt_at\)/);
      expect(definition).toMatch(/max_attempts BETWEEN 1 AND 11 AND attempt_number <= max_attempts/);
      expect(definition).toMatch(/recovery_count <= 1/);
      expect(definition).toMatch(
        /FOREIGN KEY \(organization_id\)[\s\S]*?REFERENCES organizations \(id\) ON DELETE CASCADE ON UPDATE RESTRICT/,
      );
    }
  });

  test('creates durable global and organization UTC-day quota rows with restart-safe counters', () => {
    for (const source of [migration, schema]) {
      const definition = usageDefinition(source);
      expect(definition).toMatch(/usage_date\s+DATE NOT NULL/);
      expect(definition).toMatch(/scope_type\s+ENUM\('global','organization'\)\s+NOT NULL/);
      expect(definition).toMatch(/scope_id\s+BIGINT UNSIGNED NOT NULL/);
      expect(definition).toMatch(/trap_count\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/varbind_bytes\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/delivery_count\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/metadata_only_count\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/dropped_trap_count\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/forwarding_skipped_count\s+BIGINT UNSIGNED NOT NULL DEFAULT 0/);
      expect(definition).toMatch(/PRIMARY KEY \(usage_date, scope_type, scope_id\)/);
      expect(definition).toMatch(
        /CHECK \(\s*\(scope_type = 'global' AND scope_id = 0\)\s+OR \(scope_type = 'organization' AND scope_id > 0\)\s*\)/,
      );
    }
    expect(migration).toMatch(
      /table_name = 'snmp_trap_ingest_daily_usage'[\s\S]*?usage_date[\s\S]*?scope_type[\s\S]*?scope_id[\s\S]*?trap_count[\s\S]*?varbind_bytes[\s\S]*?delivery_count[\s\S]*?metadata_only_count[\s\S]*?dropped_trap_count[\s\S]*?forwarding_skipped_count/,
    );
    expect(migration).toMatch(
      /table_name = 'snmp_trap_forwarding_deliveries' AND column_name IN\s*\(\s*'id','organization_id','organization_epoch','target_type','payload','claim_token','recovery_count','revoked_at'\)/,
    );
    expect(migration).toMatch(
      /table_name = 'webhook_deliveries' AND column_name IN\s*\(\s*'status','locked_at','claim_token','target_url','recovery_count','organization_epoch','revoked_at'\)/,
    );
    expect(migration).toMatch(
      /table_name = 'snmp_traps'[\s\S]*?'varbinds_truncated','varbinds_original_count','varbinds_truncation_reason'/,
    );
    expect(migration).toMatch(/<> 35/);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS snmp_trap_ingest_daily_usage/);
  });

  test('upgrades generic webhook outboxes to durable claim ownership before completion', () => {
    expect(schema).toMatch(
      /status\s+ENUM\('pending','processing','success','failed','retrying','dead_letter'\)/,
    );
    expect(schema).toMatch(/locked_at\s+DATETIME\s+NULL/);
    expect(schema).toMatch(/claim_token\s+CHAR\(36\)\s+NULL/);
    expect(schema).toMatch(/target_url\s+VARCHAR\(2048\)\s+NULL/);
    expect(schema).toMatch(/recovery_count\s+TINYINT UNSIGNED NOT NULL DEFAULT 0/);
    for (const column of ['locked_at', 'claim_token', 'target_url', 'recovery_count', 'revoked_at']) {
      expect(migration).toMatch(new RegExp(
        `table_name = 'webhook_deliveries'[\\s\\S]*?column_name = '${column}'`,
      ));
    }
    expect(migration).toMatch(/column_type LIKE '%processing%'/);
    expect(migration).toMatch(/idx_webhook_deliveries_processing/);
  });

  test('configuration mutation durably revokes processing rows before an A-to-B-to-A edit', () => {
    for (const source of [migration, schema]) {
      const trapTrigger = source.match(
        /CREATE TRIGGER trg_stfr_cancel_unclaimed_bu[\s\S]*?AFTER UPDATE ON snmp_trap_forwarding_rules[\s\S]*?END\$\$/,
      );
      expect(trapTrigger).toBeDefined();
      expect(trapTrigger[0]).toMatch(
        /SET revoked_at = COALESCE\(revoked_at, NOW\(\)\)[\s\S]*?status = 'processing'/,
      );

      const webhookTrigger = source.match(
        /CREATE TRIGGER trg_webhooks_cancel_trap_unclaimed_bu[\s\S]*?AFTER UPDATE ON webhooks[\s\S]*?END\$\$/,
      );
      expect(webhookTrigger).toBeDefined();
      expect(webhookTrigger[0].match(
        /SET revoked_at = COALESCE\(revoked_at, NOW\(\)\)/g,
      )).toHaveLength(2);
      expect(webhookTrigger[0]).toMatch(/UPDATE webhook_deliveries[\s\S]*?status = 'processing'/);
    }
    expect(rollback).toMatch(/ALTER TABLE webhook_deliveries DROP COLUMN revoked_at/);
  });

  test('fences every queued outbound row with a monotonic organization lifecycle epoch', () => {
    for (const source of [migration, schema]) {
      const delivery = deliveryDefinition(source);
      expect(delivery).toMatch(/organization_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 0/);
      expect(source).toMatch(
        /webhook_deliveries[\s\S]*?organization_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 0/,
      );
      expect(source).toMatch(
        /organizations[\s\S]*?outbound_delivery_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 0/,
      );

      const epochTrigger = source.match(
        /CREATE TRIGGER trg_organizations_outbound_epoch_bu[\s\S]*?BEFORE UPDATE ON organizations[\s\S]*?END\$\$/,
      );
      expect(epochTrigger).toBeDefined();
      expect(epochTrigger[0]).toMatch(/NEW\.status[\s\S]*?OLD\.status/);
      expect(epochTrigger[0]).toMatch(/NEW\.deleted_at[\s\S]*?OLD\.deleted_at/);
      expect(epochTrigger[0]).toMatch(
        /SET NEW\.outbound_delivery_epoch = OLD\.outbound_delivery_epoch \+ 1/,
      );

      const cancelTrigger = source.match(
        /CREATE TRIGGER trg_organizations_cancel_outbound_au[\s\S]*?AFTER UPDATE ON organizations[\s\S]*?END\$\$/,
      );
      expect(cancelTrigger).toBeDefined();
      expect(cancelTrigger[0]).toMatch(
        /snmp_trap_forwarding_deliveries[\s\S]*?organization_epoch <> NEW\.outbound_delivery_epoch/,
      );
      expect(cancelTrigger[0]).toMatch(
        /webhook_deliveries[\s\S]*?wd\.organization_epoch <> NEW\.outbound_delivery_epoch/,
      );
      expect(cancelTrigger[0]).toMatch(/status IN \('pending','retrying'\)/);
    }

    for (const column of ['organization_epoch', 'outbound_delivery_epoch']) {
      expect(rollback).toContain(`DROP COLUMN ${column}`);
    }
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_organizations_outbound_epoch_bu/);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_organizations_cancel_outbound_au/);
  });

  test('persists bounded trap-payload truncation metadata without storing discarded values', () => {
    for (const source of [migration, schema]) {
      const normalized = source.replace(/''/g, "'");
      expect(normalized).toMatch(/varbinds_truncated\s+TINYINT\(1\)\s+NOT NULL DEFAULT 0/);
      expect(normalized).toMatch(/varbinds_original_count\s+SMALLINT UNSIGNED\s+NOT NULL DEFAULT 0/);
      expect(normalized).toMatch(
        /varbinds_truncation_reason\s+ENUM\('count_limit','size_limit','count_and_size_limit','daily_byte_quota'\)\s+NULL/,
      );
    }
  });

  test('links outcomes to their rule, stored trap, and selected webhook', () => {
    for (const source of [migration, schema]) {
      const definition = deliveryDefinition(source);
      expect(definition).toMatch(/FOREIGN KEY \(rule_id\)[\s\S]*?REFERENCES snmp_trap_forwarding_rules \(id\)/);
      expect(definition).toMatch(/FOREIGN KEY \(trap_id\)[\s\S]*?REFERENCES snmp_traps \(id\)/);
      expect(definition).toMatch(/FOREIGN KEY \(webhook_id\)[\s\S]*?REFERENCES webhooks \(id\)/);
    }
  });

  test('documents and preserves the outbound payload privacy boundary', () => {
    expect(deliveryDefinition(migration)).toMatch(
      /payload\s+JSON NOT NULL[^\n]*never community\/credentials\/varbind values/i,
    );
    expect(schema).toMatch(
      /snmp_trap_forwarding_deliveries[^\n]*[\s\S]{0,300}Payload contains allowlisted metadata only/i,
    );
  });

  test('exposes only summarized outcome fields on rules', () => {
    for (const source of [migration, schema]) {
      const normalized = source.replace(/''/g, "'");
      expect(normalized).toMatch(/last_delivery_status\s+ENUM\('pending','processing','retrying','success','dead_letter','cancelled'\)/);
      expect(normalized).toMatch(/last_delivery_at\s+DATETIME\s+NULL/);
      expect(normalized).toMatch(/last_error\s+VARCHAR\(500\)\s+NULL/);
      expect(normalized).toMatch(/last_delivery_is_test\s+TINYINT\(1\)\s+NOT NULL DEFAULT 0/);
    }
  });

  test('irreversibly scrubs destination secrets from historical trap-rule audit snapshots', () => {
    expect(migration).toMatch(/DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu/);
    expect(migration).toMatch(/UPDATE audit_logs[\s\S]*?entity_type\s*=\s*'snmp_trap_forwarding_rules'/);
    for (const column of ['old_values', 'new_values']) {
      expect(migration).toMatch(new RegExp(
        `${column}\\s*=\\s*(?:CASE[\\s\\S]*?)?JSON_REMOVE\\(${column}`,
        'i',
      ));
    }
    for (const field of [
      'forward_to_url',
      'forward_to_email',
      'forward_to_webhook_id',
      'transform_template',
    ]) {
      const occurrences = migration.match(new RegExp(`\\$\\.${field}`, 'g')) || [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    }
    expect(migration).toMatch(
      /CREATE TRIGGER (?:IF NOT EXISTS )?trg_audit_logs_immutable_bu[\s\S]*?BEFORE UPDATE ON audit_logs[\s\S]*?SIGNAL SQLSTATE '45000'[\s\S]*?Audit logs are immutable and cannot be updated/,
    );
    expect(rollback).not.toMatch(/forward_to_url|forward_to_email|forward_to_webhook_id|transform_template/);
  });

  test('audit scrub is crash-safe and rerunnable without an immutability gap', () => {
    const guardName = 'trg_audit_logs_459_scrub_guard_bu';
    const guardCreate = migration.indexOf(`CREATE TRIGGER IF NOT EXISTS ${guardName}`);
    const mainDrop = migration.indexOf('DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu');
    const bypassOn = migration.search(/SET\s+@fireisp_459_audit_scrub\s*=\s*1/i);
    const scrub = migration.indexOf('UPDATE audit_logs');
    const bypassOff = migration.search(
      /SET\s+@fireisp_459_audit_scrub\s*=\s*(?:NULL|0)/i,
    );
    const mainCreate = migration.search(
      /CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_bu/i,
    );
    const guardDrop = migration.indexOf(`DROP TRIGGER IF EXISTS ${guardName}`);

    expect(guardCreate).toBeGreaterThan(-1);
    expect(guardCreate).toBeLessThan(mainDrop);
    expect(mainDrop).toBeLessThan(bypassOn);
    expect(bypassOn).toBeLessThan(scrub);
    expect(scrub).toBeLessThan(bypassOff);
    expect(bypassOff).toBeLessThan(mainCreate);
    expect(mainCreate).toBeLessThan(guardDrop);

    // A crashed migration connection loses the session-local bypass, leaving
    // the guard immutable. IF NOT EXISTS lets the migration safely rerun when
    // a previous attempt left either trigger behind.
    const guardDefinition = migration.slice(guardCreate, mainDrop);
    expect(guardDefinition).toMatch(/@fireisp_459_audit_scrub/);
    expect(guardDefinition).toMatch(/SIGNAL SQLSTATE '45000'/);
    expect(guardDefinition).toMatch(/Audit logs are immutable/i);
  });

  test('scrubs historical community strings and unattributed payloads without restoring them', () => {
    expect(migration).toMatch(
      /(?:UPDATE snmp_traps\s+SET community = NULL|ALTER TABLE snmp_traps[\s\S]*?DROP COLUMN community)/,
    );
    expect(migration).toMatch(
      /UPDATE snmp_traps\s+SET varbinds = JSON_ARRAY\(\)\s+WHERE organization_id IS NULL/,
    );
    expect(rollback).not.toMatch(/UPDATE snmp_traps\s+SET community\s*=\s*(?!NULL)/);
    expect(rollback).not.toMatch(/UPDATE snmp_traps\s+SET varbinds/);
  });

  test('seeds full trap-payload access only for admin and super_admin roles', () => {
    for (const source of [migration, schema]) {
      const permissionAt = source.indexOf('snmp_traps.payload.view');
      expect(permissionAt).toBeGreaterThan(-1);
      const permissionSeed = source.slice(permissionAt, permissionAt + 1800);
      expect(permissionSeed).toMatch(/INSERT IGNORE INTO role_permissions/);
      expect(permissionSeed).toMatch(/WHERE r\.name IN \('admin',\s*'super_admin'\)/);
      expect(permissionSeed).not.toMatch(/WHERE r\.name IN \([^)]*(?:technician|readonly|support|billing)/);
    }
  });

  test('rollback drops the delivery table before its rule summary columns and never re-enables legacy rules', () => {
    const tableDrop = rollback.indexOf('DROP TABLE IF EXISTS snmp_trap_forwarding_deliveries');
    const alterRule = rollback.indexOf('ALTER TABLE snmp_trap_forwarding_rules');

    expect(tableDrop).toBeGreaterThan(-1);
    expect(tableDrop).toBeLessThan(alterRule);
    expect(rollback).not.toMatch(/SET\s+is_active\s*=\s*(?:TRUE|1)/i);
    expect(rollback).toMatch(/DROP COLUMN last_delivery_status/);
    expect(rollback).toMatch(/DROP COLUMN last_delivery_is_test/);
  });
});
