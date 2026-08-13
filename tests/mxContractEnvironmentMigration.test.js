'use strict';

const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'migrations', '452_mx_contract_environment.sql'),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'rollbacks', '452_mx_contract_environment.sql'),
  'utf8',
);

describe('migration 452 rerun safety', () => {
  test('does not redefine the environment FK parent column after its default is canonical', () => {
    const alter = 'ALTER TABLE contract_templates_mx\n      MODIFY COLUMN environment';
    const alterIndex = migration.indexOf(alter);
    const guardIndex = migration.lastIndexOf('IF EXISTS (', alterIndex);
    const previousGuardEnd = migration.lastIndexOf('END IF;', alterIndex);
    const guard = migration.slice(guardIndex, alterIndex);

    expect(alterIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(previousGuardEnd);
    expect(guard).toContain("TABLE_NAME = 'contract_templates_mx'");
    expect(guard).toContain("COLUMN_NAME = 'environment'");
    expect(guard).toContain(
      "COALESCE(COLUMN_DEFAULT, '') NOT IN ('sandbox', '''sandbox''')",
    );
    expect(migration.slice(alterIndex)).toMatch(/DEFAULT 'sandbox'[\s\S]*?END IF;/);
  });

  test('status FSM blocks sandbox revival in production and rollback restores migration 450', () => {
    expect(migration).toMatch(/DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu/);
    expect(migration).toMatch(/OLD\.mx_contract_environment = 'sandbox'/);
    expect(migration).toMatch(/current_org_locale = 'MX'/);
    expect(migration).toMatch(
      /OLD\.contract_template_mx_id IS NULL OR OLD\.mx_contract_environment IS NULL/,
    );
    expect(migration).toMatch(/create a new classified MX contract/);
    expect(migration).toMatch(/NEW\.status IN \('pending', 'active'\)/);
    expect(migration).toMatch(/legacy_source\.environment = 'production'/);
    expect(migration).toMatch(/OLD\.deleted_at IS NOT NULL AND NEW\.deleted_at IS NULL/);
    expect(migration).toMatch(
      /SELECT organization_row\.locale,[\s\S]*CASE[\s\S]*INTO current_org_locale, current_mx_contract_environment[\s\S]*FOR UPDATE/,
    );

    const triggerStart = rollback.indexOf('DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu');
    const rollbackTrigger = rollback.slice(
      triggerStart,
      rollback.indexOf('DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment', triggerStart),
    );
    expect(rollbackTrigger).not.toMatch(/mx_contract_environment|contract_environment/);
    expect(rollbackTrigger).toMatch(
      /OLD\.status IN \('expired', 'cancelled', 'terminated'\) AND NEW\.status IN \('pending', 'active'\)/,
    );
  });

  test('database classifies new MX contracts and freezes their source snapshot', () => {
    const insertTrigger = migration.slice(
      migration.indexOf('CREATE TRIGGER trg_contracts_mx_template_bi'),
      migration.indexOf('DROP TRIGGER IF EXISTS trg_contracts_mx_template_bu'),
    );
    const updateTrigger = migration.slice(
      migration.indexOf('CREATE TRIGGER trg_contracts_mx_template_bu'),
      migration.indexOf('-- A sandbox snapshot is permanent test provenance'),
    );

    expect(migration).toMatch(/CREATE TRIGGER trg_contracts_mx_template_bi/);
    expect(migration).toMatch(/MX contracts require a classified contract source and environment/);
    expect(migration).toMatch(/NEW\.mx_contract_environment <> current_contract_environment/);
    expect(insertTrigger).toMatch(/source\.organization_id INTO source_org_id/);
    expect(insertTrigger).toMatch(
      /source\.environment = 'sandbox'[\s\S]*source\.status = 'sandbox_ready'[\s\S]*source\.ift_registration_number IS NULL[\s\S]*source\.registered_at IS NULL/,
    );
    expect(insertTrigger).toMatch(
      /source\.environment = 'production'[\s\S]*source\.status = 'registered'[\s\S]*source\.ift_registration_number IS NOT NULL[\s\S]*source\.registered_at IS NOT NULL/,
    );
    expect(insertTrigger).toMatch(
      /FROM document_templates activation_template[\s\S]*activation_template\.organization_id = contract_org_id[\s\S]*activation_template\.contract_template_mx_id = source\.id[\s\S]*activation_template\.template_type = 'activation_contract'[\s\S]*activation_template\.is_active = 1[\s\S]*activation_template\.deleted_at IS NULL[\s\S]*BINARY activation_template\.body_md = BINARY source\.template_body/,
    );
    expect(insertTrigger).toMatch(
      /NOT EXISTS \([\s\S]*FROM document_templates competing_template[\s\S]*competing_template\.is_active = 1/,
    );
    expect(migration).toMatch(/CREATE TRIGGER trg_contracts_mx_template_bu/);
    expect(migration).toMatch(/NOT \(NEW\.mx_contract_environment <=> OLD\.mx_contract_environment\)/);
    expect(updateTrigger).toMatch(
      /NOT \(NEW\.contract_template_mx_id <=> OLD\.contract_template_mx_id\)[\s\S]*OLD\.status <> 'pending'[\s\S]*FROM signed_documents document_history/,
    );
    expect(updateTrigger).toMatch(
      /Revalidate current readiness only when deliberately repairing the source[\s\S]*IF NOT \(NEW\.contract_template_mx_id <=> OLD\.contract_template_mx_id\) THEN[\s\S]*SELECT source\.organization_id INTO source_org_id/,
    );
    expect(updateTrigger).not.toMatch(/IF NEW\.contract_template_mx_id IS NOT NULL THEN/);

    const restored087 = rollback.slice(
      rollback.indexOf('DROP TRIGGER IF EXISTS trg_contracts_mx_template_bi'),
      rollback.indexOf('DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment',
        rollback.indexOf('DROP TRIGGER IF EXISTS trg_contracts_mx_template_bi')),
    );
    expect(restored087).toMatch(/SELECT locale INTO v_locale FROM clients/);
    expect(restored087).not.toMatch(/mx_contract_environment|current_contract_environment/);
  });

  test('signed-document MX provenance is immutable without blocking v2 to v3 signing', () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_signed_documents_mx_snapshot_bu/);
    for (const field of [
      'contract_template_mx_id', 'mx_contract_environment', 'mx_registration_number',
      'mx_registered_at', 'mx_template_version', 'mx_source_sha256',
    ]) {
      expect(migration).toMatch(new RegExp(`NEW\\.${field} <=> OLD\\.${field}`));
    }
    const snapshotTrigger = migration.slice(
      migration.indexOf('CREATE TRIGGER trg_signed_documents_mx_snapshot_bu'),
    );
    expect(snapshotTrigger).not.toMatch(/evidence_format_version <=>/);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_signed_documents_mx_snapshot_bu/);
  });
});
