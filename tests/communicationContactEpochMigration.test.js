'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { splitStatements } = require('../src/scripts/migrate');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('database/migrations/460_client_communication_contact_epoch.sql');
const rollback = read('database/rollbacks/460_client_communication_contact_epoch.sql');
const schema = read('database/schema.sql');

function epochTrigger(source) {
  const trigger = source.match(
    /CREATE TRIGGER trg_clients_communication_contact_epoch_bu[\s\S]*?BEFORE UPDATE ON clients[\s\S]*?END\$\$/,
  );
  expect(trigger).toBeDefined();
  return trigger[0];
}

describe('migration 460 client communication-contact epoch', () => {
  test('irreversibly disables malformed or plaintext SMTP credential storage', () => {
    expect(migration).toMatch(
      /UPDATE organization_email_settings\s+SET enabled = 0,\s+smtp_password_encrypted = NULL,\s+last_test_status = 'failed',\s+last_test_error = 'The saved SMTP credential is unavailable\.'/,
    );
    expect(migration).toContain(
      "smtp_password_encrypted NOT REGEXP\n      '^[0-9A-Fa-f]{24}:[0-9A-Fa-f]{32}:([0-9A-Fa-f]{2})+$'",
    );
    expect(rollback).toMatch(/SMTP credentials scrubbed[\s\S]*not restored/i);
    expect(rollback).not.toMatch(/SET\s+smtp_password_encrypted\s*=/i);
  });

  test('a migration rerun preserves the generic unavailable-credential sentinel', () => {
    const scrub = migration.match(
      /UPDATE organization_email_settings[\s\S]*?WHERE smtp_password_encrypted IS NOT NULL[\s\S]*?;/,
    );
    expect(scrub).toBeDefined();
    expect(scrub[0]).toContain("last_test_error = 'The saved SMTP credential is unavailable.'");
    expect(scrub[0]).toMatch(/WHERE smtp_password_encrypted IS NOT NULL\s+AND smtp_password_encrypted NOT REGEXP/);
    // After the first pass the ciphertext is NULL, so the rerun predicate is
    // false. The independent historical-error scrub also exempts this exact
    // sentinel, so neither statement can overwrite it on a rerun.
    expect(migration).toMatch(
      /SET last_test_error = 'Email delivery failed\.'[\s\S]*?last_test_error <> 'The saved SMTP credential is unavailable\.'/,
    );
    expect(migration.match(/last_test_error\s*=/g)).toHaveLength(2);
  });

  test('adds fail-closed epoch defaults to the migration and canonical schema', () => {
    for (const source of [migration, schema]) {
      expect(source).toMatch(
        /email_contact_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 1[\s\S]*?email identity/i,
      );
      expect(source).toMatch(
        /phone_contact_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 1[\s\S]*?phone identity/i,
      );
      expect(source).toMatch(
        /communication_contact_epoch\s+BIGINT UNSIGNED\s+NOT NULL DEFAULT 0[\s\S]*?consent/i,
      );
    }

    expect(migration).toMatch(
      /information_schema\.columns[\s\S]*?table_name = 'clients'[\s\S]*?column_name = 'email_contact_epoch'/,
    );
    expect(migration).toMatch(
      /information_schema\.columns[\s\S]*?table_name = 'clients'[\s\S]*?column_name = 'phone_contact_epoch'/,
    );
    expect(migration).toMatch(
      /information_schema\.columns[\s\S]*?table_name = 'subscriber_consents'[\s\S]*?column_name = 'communication_contact_epoch'/,
    );
  });

  test('increments only the byte-distinct or NULL-distinct destination epoch', () => {
    for (const source of [migration, schema]) {
      const trigger = epochTrigger(source);
      expect(trigger).toMatch(/NOT \(BINARY NEW\.email <=> BINARY OLD\.email\)/);
      expect(trigger).toMatch(/NOT \(BINARY NEW\.phone <=> BINARY OLD\.phone\)/);
      expect(trigger.match(/NOT \(NEW\.deleted_at <=> OLD\.deleted_at\)/g)).toHaveLength(2);
      expect(trigger.match(/\(\(NEW\.status = 'inactive'\) <> \(OLD\.status = 'inactive'\)\)/g))
        .toHaveLength(2);
      expect(trigger).toMatch(
        /NEW\.email[\s\S]*?OR NOT \(NEW\.deleted_at <=> OLD\.deleted_at\)[\s\S]*?SET NEW\.email_contact_epoch = OLD\.email_contact_epoch \+ 1[\s\S]*?ELSE\s+SET NEW\.email_contact_epoch = OLD\.email_contact_epoch/,
      );
      expect(trigger).toMatch(
        /NEW\.phone[\s\S]*?OR NOT \(NEW\.deleted_at <=> OLD\.deleted_at\)[\s\S]*?SET NEW\.phone_contact_epoch = OLD\.phone_contact_epoch \+ 1[\s\S]*?ELSE\s+SET NEW\.phone_contact_epoch = OLD\.phone_contact_epoch/,
      );
    }
  });

  test('inactive boundary fences both channels while active-to-suspended alone does not', () => {
    for (const source of [migration, schema]) {
      const trigger = epochTrigger(source);
      const lifecyclePredicates = trigger.match(
        /\(\(NEW\.status = 'inactive'\) <> \(OLD\.status = 'inactive'\)\)/g,
      ) || [];
      expect(lifecyclePredicates).toHaveLength(2);
      expect(trigger).not.toMatch(/NOT \(NEW\.status <=> OLD\.status\)/);
      expect(trigger).not.toMatch(/NEW\.status <> OLD\.status/);
    }
  });

  test('persists a server-owned class without defaulting legacy queue rows', () => {
    for (const source of [migration, schema]) {
      const normalized = source.replace(/''/g, "'");
      const definitions = normalized.match(
        /message_class\s+ENUM\('marketing','transactional','security','support_reply'\)\s+NULL/g,
      ) || [];
      expect(definitions).toHaveLength(2);
    }
    expect(migration).toMatch(/table_name = 'email_logs'[\s\S]*?column_name = 'message_class'/);
    expect(migration).toMatch(/table_name = 'sms_logs'[\s\S]*?column_name = 'message_class'/);
    expect(migration).toMatch(/message_class[\s\S]*?NULL legacy client work fails closed/i);
    expect(migration).not.toMatch(/message_class[\s\S]{0,100}DEFAULT/i);
  });

  test('terminalizes queued email and SMS whose client provenance cannot be proven', () => {
    expect(migration).toMatch(
      /UPDATE email_logs\s+SET status = 'failed',[\s\S]*?WHERE status = 'queued'\s+AND \(client_id IS NULL OR message_class IS NULL\);/,
    );
    expect(migration).toMatch(
      /UPDATE sms_logs\s+SET status = 'failed',[\s\S]*?WHERE status = 'queued'\s+AND direction = 'outbound'\s+AND \(client_id IS NULL OR message_class IS NULL\);/,
    );
    expect(migration.match(
      /error_message = 'Legacy queued client authorization unavailable; message skipped\.'/g,
    ))
      .toHaveLength(2);
  });

  test('fences only legacy-provenance failed SMS and campaign rows as outcome-unknown', () => {
    expect(migration).toMatch(
      /UPDATE sms_logs\s+SET error_code = 'DELIVERY_OUTCOME_UNKNOWN',[\s\S]*?WHERE status = 'failed'\s+AND direction = 'outbound'\s+AND message_class IS NULL[\s\S]*?error_code <=> 'CLIENT_NOT_FOUND'[\s\S]*?Legacy queued client authorization unavailable; message skipped\.'[\s\S]*?\);/,
    );
    expect(migration).toMatch(
      /UPDATE campaign_messages\s+SET error_message = 'Provider invocation started; delivery outcome is unknown'\s+WHERE status = 'failed'\s+AND client_contact_epoch = 0;/,
    );
    expect(migration.indexOf("SET error_code = 'DELIVERY_OUTCOME_UNKNOWN'"))
      .toBeLessThan(migration.indexOf('UPDATE sms_logs\nSET status = \'failed\''));
    expect(rollback).toMatch(/outcome-unknown delivery fences are also retained/i);
  });

  test('never guesses NULL client ownership and repairs dependents only from a non-NULL owner', () => {
    expect(migration).not.toMatch(/UPDATE\s+clients\b/i);
    expect(migration).not.toMatch(/SET\s+c\.organization_id\s*=/i);
    expect(migration).toMatch(
      /UPDATE subscriber_consents consent\s+JOIN clients c ON c\.id = consent\.client_id\s+SET consent\.organization_id = c\.organization_id\s+WHERE c\.organization_id IS NOT NULL\s+AND NOT \(consent\.organization_id <=> c\.organization_id\);/,
    );
    expect(migration).toMatch(
      /UPDATE whatsapp_links link_row\s+JOIN clients c ON c\.id = link_row\.client_id\s+SET link_row\.organization_id = c\.organization_id\s+WHERE c\.organization_id IS NOT NULL\s+AND NOT \(link_row\.organization_id <=> c\.organization_id\);/,
    );
    expect(rollback).toMatch(/Client\/DND\/consent\/WhatsApp tenant-ownership repairs[\s\S]*retained/i);
  });

  test('widens SMS refusal codes before upgraded workers persist stable policy codes', () => {
    expect(migration).toMatch(
      /ALTER TABLE sms_logs\s+MODIFY COLUMN error_code VARCHAR\(64\) NULL[\s\S]*?Provider or stable application refusal code/,
    );
    expect(schema).toMatch(
      /error_code\s+VARCHAR\(64\)\s+NULL[\s\S]*?Provider or stable application refusal code/,
    );
    expect(migration.indexOf('MODIFY COLUMN error_code VARCHAR(64)'))
      .toBeLessThan(migration.indexOf('UPDATE sms_logs\nSET status = \'failed\''));
  });

  test('snapshots the organization lifecycle epoch on every durable client-delivery queue', () => {
    for (const table of ['email_logs', 'sms_logs', 'campaign_messages']) {
      expect(migration).toMatch(
        new RegExp(`table_name = '${table}'[\\s\\S]*?column_name = 'organization_epoch'`),
      );
      expect(rollback).toContain(`ALTER TABLE ${table} DROP COLUMN organization_epoch`);
    }
  });

  test('snapshots the client contact epoch on every durable client-delivery queue', () => {
    for (const source of [migration, schema]) {
      for (const table of ['email_logs', 'sms_logs', 'campaign_messages']) {
        expect(source.replace(/''/g, "'")).toMatch(
          new RegExp(`${table}[\\s\\S]*?client_contact_epoch\\s+BIGINT UNSIGNED\\s+NOT NULL DEFAULT 0`),
        );
      }
    }
    for (const table of ['email_logs', 'sms_logs', 'campaign_messages']) {
      expect(migration).toMatch(
        new RegExp(`table_name = '${table}'[\\s\\S]*?column_name = 'client_contact_epoch'`),
      );
      expect(rollback).toContain(`ALTER TABLE ${table} DROP COLUMN client_contact_epoch`);
    }
  });

  test('withdraws only legacy active marketing consent and is safe to resume', () => {
    expect(migration).toMatch(
      /UPDATE subscriber_consents\s+SET withdrawn_at = CURRENT_TIMESTAMP\s+WHERE purpose = 'marketing'\s+AND communication_contact_epoch = 0\s+AND withdrawn_at IS NULL/,
    );
    expect(migration.trimStart()).toMatch(/^DELIMITER \$\$/);

    const statements = splitStatements(migration);
    expect(statements.length).toBeGreaterThan(5);
    for (const statement of statements) {
      const executable = statement
        .replace(/^\s*--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      expect(executable).not.toBe('');
    }
  });

  test('rollback is guarded and does not resurrect withdrawn consent', () => {
    expect(rollback.trimStart()).toMatch(/^DELIMITER \$\$/);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_clients_communication_contact_epoch_bu/);
    expect(rollback).toContain('ALTER TABLE sms_logs DROP COLUMN message_class');
    expect(rollback).toContain('ALTER TABLE email_logs DROP COLUMN message_class');
    expect(rollback).toContain('ALTER TABLE subscriber_consents DROP COLUMN communication_contact_epoch');
    expect(rollback).toContain('ALTER TABLE clients DROP COLUMN phone_contact_epoch');
    expect(rollback).toContain('ALTER TABLE clients DROP COLUMN email_contact_epoch');
    expect(rollback.match(/information_schema\.columns/g)).toHaveLength(11);
    expect(rollback).toMatch(/withdrawals[\s\S]*intentionally not[\s\S]*reversed/i);
    expect(rollback).not.toMatch(/SET\s+withdrawn_at\s*=\s*NULL/i);
  });
});
