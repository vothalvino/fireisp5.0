'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const migration = read('database/migrations/458_mx_snii_infrastructure_reporting.sql');
const rollback = read('database/rollbacks/458_mx_snii_infrastructure_reporting.sql');
const schema = read('database/schema.sql');

const TABLES = [
  'snii_reporting_profiles',
  'snii_element_applicability',
  'snii_asset_registry',
  'snii_report_batches',
  'snii_report_items',
  'snii_report_artifacts',
  'snii_evidence_uploads',
  'snii_filing_events',
  'snii_audit_events',
];

function tableDefinitionFrom(source, table) {
  const match = source.match(new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB`,
  ));
  expect(match).toBeDefined();
  return match[0];
}

function tableDefinition(table) {
  return tableDefinitionFrom(migration, table);
}

function columnNames(definition) {
  return definition.split('\n').flatMap((line) => {
    const match = line.match(/^\s{2}([a-z][a-z0-9_]*)\s+/i);
    if (!match || ['primary', 'unique', 'key', 'constraint', 'check'].includes(
      match[1].toLowerCase(),
    )) return [];
    return [match[1]];
  });
}

function triggerDefinition(trigger) {
  const match = migration.match(new RegExp(
    `CREATE TRIGGER ${trigger}[\\s\\S]*?END//`,
  ));
  expect(match).toBeDefined();
  return match[0];
}

describe('migration 458 SNII security and evidence contract', () => {
  test('makes tenant ownership mandatory throughout the SNII data graph', () => {
    for (const table of TABLES) {
      expect(tableDefinition(table)).toMatch(
        /organization_id\s+BIGINT UNSIGNED NOT NULL/,
      );
    }

    expect(migration).toMatch(
      /FOREIGN KEY \(profile_id, organization_id\)\s+REFERENCES snii_reporting_profiles\(id, organization_id\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(batch_id, organization_id\)\s+REFERENCES snii_report_batches\(id, organization_id\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(registry_asset_id, organization_id\)\s+REFERENCES snii_asset_registry\(id, organization_id\)/,
    );
    expect(migration).not.toMatch(/ON DELETE CASCADE/);

    // MySQL and MariaDB reject a CHECK column that also participates in an
    // ON UPDATE CASCADE foreign key (for example the frozen title/lineage
    // checks below). SNII identifiers and tenant ownership are immutable, so
    // every relationship must fail closed instead of cascading an update.
    for (const table of TABLES) {
      expect(tableDefinition(table)).not.toMatch(/ON UPDATE CASCADE/);
      expect(tableDefinitionFrom(schema, table)).not.toMatch(/ON UPDATE CASCADE/);
    }
    expect(tableDefinition('snii_reporting_profiles')).toMatch(
      /FOREIGN KEY \(concession_title_id, organization_id\)[\s\S]*?ON UPDATE RESTRICT/,
    );
    expect(tableDefinition('snii_report_batches')).toMatch(
      /FOREIGN KEY \(supersedes_batch_id, organization_id\)[\s\S]*?ON UPDATE RESTRICT/,
    );
    expect(tableDefinition('snii_report_batches')).toMatch(
      /FOREIGN KEY \(correction_root_batch_id, organization_id\)[\s\S]*?ON UPDATE RESTRICT/,
    );
  });

  test('keeps every SNII table column-identical in migration and fresh-install schema', () => {
    for (const table of TABLES) {
      expect(columnNames(tableDefinitionFrom(schema, table))).toEqual(
        columnNames(tableDefinition(table)),
      );
    }
  });

  test('binds a concession title to the same tenant rather than only to a global id', () => {
    const profile = tableDefinition('snii_reporting_profiles');
    const batch = tableDefinition('snii_report_batches');
    expect(profile).toMatch(
      /FOREIGN KEY \(concession_title_id, organization_id\)\s+REFERENCES concession_titles\(id, organization_id\)/,
    );
    expect(batch).toMatch(
      /FOREIGN KEY \(concession_title_id, organization_id\)\s+REFERENCES concession_titles\(id, organization_id\)/,
    );
    for (const definition of [profile, batch]) {
      expect(definition).toMatch(/concession_title_snapshot\s+JSON/);
      expect(definition).toMatch(/concession_title_sha256\s+CHAR\(64\)/);
    }
    expect(batch).toMatch(/applicability_snapshot\s+JSON NOT NULL/);
  });

  test('defaults legal applicability and asset inclusion to unreviewed', () => {
    expect(tableDefinition('snii_element_applicability')).toMatch(
      /applicability\s+ENUM\('unreviewed','applicable','not_applicable'\) NOT NULL DEFAULT 'unreviewed'/,
    );
    expect(tableDefinition('snii_asset_registry')).toMatch(
      /decision\s+ENUM\('unreviewed','included','excluded'\) NOT NULL DEFAULT 'unreviewed'/,
    );
    expect(migration).toMatch(
      /decision = 'unreviewed'[\s\S]*classified_by IS NOT NULL[\s\S]*source_snapshot_hash IS NOT NULL/,
    );
  });

  test('pins every reviewed official source and requires two-person asset approval', () => {
    const profile = tableDefinition('snii_reporting_profiles');
    for (const field of [
      'source_channel', 'source_attestation_reference',
      'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
      'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
      'template_version', 'template_source_url', 'template_sha256',
      'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
      'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
      'official_sources_reviewed_by', 'official_sources_reviewed_at',
    ]) {
      expect(profile).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]*NOT NULL`, 'm'));
    }

    const registry = tableDefinition('snii_asset_registry');
    expect(registry).toMatch(
      /approval_status\s+ENUM\('not_required','pending','approved'\) NOT NULL DEFAULT 'not_required'/,
    );
    expect(registry).toMatch(/classified_by\s+BIGINT UNSIGNED NULL/);
    expect(registry).toMatch(/approved_by\s+BIGINT UNSIGNED NULL/);
    expect(registry).toMatch(/classification_hash\s+CHAR\(64\)[^\n]*NULL/);
    expect(registry).toMatch(/classification_revision\s+INT UNSIGNED NOT NULL DEFAULT 0/);
    expect(registry).toMatch(/approved_by <> classified_by/);

    const applicability = tableDefinition('snii_element_applicability');
    expect(applicability).toMatch(
      /population_status\s+ENUM\('unreviewed','has_assets','zero_population'\) NOT NULL DEFAULT 'unreviewed'/,
    );
    expect(applicability).toMatch(
      /population_status <> 'zero_population'[\s\S]*population_evidence_reference/,
    );
  });

  test('does not let a NULL or synthetic operational identity masquerade as a reviewed source', () => {
    const registry = tableDefinition('snii_asset_registry');
    expect(registry).toMatch(
      /source_type = 'manual' AND source_id IS NULL AND manual_payload IS NOT NULL/,
    );
    expect(registry).toMatch(
      /source_type <> 'manual' AND source_id IS NOT NULL AND manual_payload IS NULL/,
    );
    expect(registry).toMatch(
      /decision = 'excluded' AND exclusion_reason IS NOT NULL/,
    );
  });

  test('records a full-load filing window and immutable evidence provenance', () => {
    const batch = tableDefinition('snii_report_batches');
    expect(batch).toMatch(/supersedes_batch_id\s+BIGINT UNSIGNED NULL/);
    expect(batch).toMatch(
      /correction_root_batch_id\s+BIGINT UNSIGNED NULL[^\n]*correction_required root[^\n]*internal replacements/,
    );
    expect(batch).toMatch(/supersession_reason\s+VARCHAR\(500\) NULL/);
    expect(batch).toMatch(
      /FOREIGN KEY \(supersedes_batch_id, organization_id\)\s+REFERENCES snii_report_batches\(id, organization_id\)/,
    );
    expect(batch).toMatch(/UNIQUE KEY uq_snii_batches_supersedes \(supersedes_batch_id\)/);
    expect(batch).toMatch(
      /KEY idx_snii_batches_correction_root_org \(correction_root_batch_id, organization_id\)/,
    );
    expect(batch).toMatch(
      /FOREIGN KEY \(correction_root_batch_id, organization_id\)\s+REFERENCES snii_report_batches\(id, organization_id\)/,
    );
    expect(batch).toMatch(
      /UNIQUE KEY uq_snii_batches_period_revision\s+\(profile_id, filing_kind, filing_year, filing_window, period_start, period_end,\s+filing_frequency, revision_no\)/,
    );
    expect(batch).toMatch(
      /CHECK \(\s*\(revision_no = 1 AND supersedes_batch_id IS NULL AND correction_root_batch_id IS NULL\s+AND supersession_reason IS NULL\)\s*OR \(revision_no > 1 AND supersedes_batch_id IS NOT NULL[\s\S]*NULLIF\(TRIM\(supersession_reason\), ''\) IS NOT NULL\s*\)/,
    );
    expect(tableDefinition('snii_asset_registry')).not.toMatch(/supersedes_batch_id/);
    expect(batch).toMatch(/filing_kind\s+ENUM\('initial','update','voluntary'\) NOT NULL/);
    expect(batch).toMatch(/filing_window\s+ENUM\([^)]+\) NOT NULL/);
    expect(batch).toMatch(/filing_year\s+SMALLINT UNSIGNED NOT NULL/);
    expect(batch).toMatch(/filing_frequency\s+ENUM\([^)]+\) NOT NULL/);
    expect(batch).toMatch(/full_load\s+TINYINT\(1\) NOT NULL DEFAULT 1/);
    expect(batch).toMatch(/CHECK \(full_load = 1\)/);
    for (const field of [
      'official_sources_reviewed_by', 'official_sources_reviewed_at', 'source_freshness_days',
    ]) {
      expect(batch).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]*NOT NULL`, 'm'));
    }
    expect(batch).toMatch(/CHECK \(source_freshness_days BETWEEN 1 AND 3650\)/);

    const artifact = tableDefinition('snii_report_artifacts');
    for (const field of [
      'catalog_version', 'official_template_filename', 'source_classification',
      'official_source_url', 'official_source_sha256', 'generator_version',
      'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
      'adapter_reconciled_at',
      'content_sha256', 'byte_size',
    ]) {
      expect(artifact).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]*NOT NULL`, 'm'));
    }
    expect(artifact).toMatch(
      /source_classification\s+ENUM\('historical_adapter_reconciled','official_template','official_dictionary','official_annex_v'\)/,
    );

    const filing = tableDefinition('snii_filing_events');
    for (const field of [
      'attempt_no', 'occurred_timezone', 'authority_reference',
      'evidence_upload_id', 'evidence_file_name', 'evidence_mime_type',
      'evidence_byte_size', 'evidence_content', 'evidence_sha256', 'event_hash',
    ]) {
      expect(filing).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]*NOT NULL`, 'm'));
    }
    expect(filing).toMatch(/evidence_content\s+LONGBLOB NOT NULL/);
  });

  test('retains copied filing evidence independently of the generic source file lifecycle', () => {
    const upload = tableDefinition('snii_evidence_uploads');
    const filing = tableDefinition('snii_filing_events');

    expect(upload).toMatch(/evidence_content\s+LONGBLOB NOT NULL[^\n]*Immutable exact/i);
    expect(upload).toMatch(/content_sha256\s+CHAR\(64\)[^\n]*NOT NULL/i);
    expect(upload).toMatch(/byte_size\s+BIGINT UNSIGNED NOT NULL/i);
    expect(filing).toMatch(
      /evidence_content\s+LONGBLOB NOT NULL[^\n]*Immutable exact/i,
    );
    expect(filing).toMatch(
      /FOREIGN KEY \(evidence_upload_id, organization_id\)\s+REFERENCES snii_evidence_uploads\(id, organization_id\) ON DELETE RESTRICT/i,
    );
    expect(`${upload}\n${filing}`).not.toMatch(/REFERENCES\s+files\s*\(/i);
    expect(`${upload}\n${filing}`).not.toMatch(/ON DELETE CASCADE/i);
  });

  test('gives edit, approval, export and filing grants only to operator roles', () => {
    const grants = migration.slice(migration.indexOf('-- Permission definitions'));

    expect(grants).toMatch(
      /p\.name IN \('snii_reporting\.view','snii_reporting\.review','snii_reporting\.prepare',[\s\S]*?'snii_reporting\.export','snii_reporting\.file',[\s\S]*?'snii_reporting\.evidence'\)[\s\S]*?r\.name IN \('admin','super_admin'\)/,
    );
    expect(grants).toMatch(
      /p\.name = 'snii_reporting\.view'[\s\S]*?r\.name IN \('readonly','auditor'\)/,
    );
    expect(grants).not.toMatch(/WHERE r\.name = 'billing'/);
    expect(grants).not.toMatch(/WHERE r\.name = 'technician'/);

    const roleGrantBlocks = grants.match(/INSERT IGNORE INTO role_permissions[\s\S]*?;/g) || [];
    const evidenceOnlyGrant = roleGrantBlocks.filter(block =>
      /p\.name = 'snii_reporting\.evidence'/.test(block));
    expect(evidenceOnlyGrant).toHaveLength(1);
    expect(evidenceOnlyGrant[0]).toMatch(/WHERE r\.name = 'auditor'/);
    expect(evidenceOnlyGrant[0]).not.toMatch(/readonly/);
  });

  test('keeps snapshot items, artifacts, filing evidence and audit events append-only', () => {
    for (const [updateTrigger, deleteTrigger] of [
      ['trg_snii_batches_snapshot_bu', 'trg_snii_batches_bd'],
      ['trg_snii_items_bu', 'trg_snii_items_bd'],
      ['trg_snii_artifacts_bu', 'trg_snii_artifacts_bd'],
      ['trg_snii_evidence_upload_bu', 'trg_snii_evidence_upload_bd'],
      ['trg_snii_filing_bu', 'trg_snii_filing_bd'],
      ['trg_snii_audit_bu', 'trg_snii_audit_bd'],
    ]) {
      expect(triggerDefinition(updateTrigger)).toMatch(/SIGNAL SQLSTATE '45000'/);
      expect(triggerDefinition(deleteTrigger)).toMatch(/SIGNAL SQLSTATE '45000'/);
    }
  });

  test('protects an approved snapshot from later content or tenant mutation', () => {
    const trigger = triggerDefinition('trg_snii_batches_snapshot_bu');
    expect(trigger).toMatch(
      /OLD\.status IN \('approved','exported','filed','correction_required','accepted','superseded'\)/,
    );
    for (const field of [
      'organization_id', 'profile_id', 'concession_title_id',
      'concession_title_snapshot', 'concession_title_sha256', 'period_start', 'period_end',
      'supersedes_batch_id', 'correction_root_batch_id', 'supersession_reason',
      'filing_kind', 'filing_window', 'filing_year',
      'filing_frequency', 'full_load',
      'revision_no', 'catalog_version',
      'element_types_snapshot', 'element_contract_snapshot', 'applicability_snapshot',
      'source_channel', 'source_attestation_reference',
      'official_sources_reviewed_by', 'official_sources_reviewed_at',
      'source_freshness_days',
      'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
      'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
      'template_version', 'template_source_url', 'template_sha256',
      'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
      'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
      'legal_basis', 'electronic_folio', 'item_count', 'snapshot_hash',
      'validation_result', 'validated_at', 'approved_by', 'approved_at',
      'created_by', 'created_at',
    ]) {
      expect(trigger).toContain(`NEW.${field} <=> OLD.${field}`);
    }
    expect(trigger).toMatch(
      /IF NOT \(NEW\.correction_root_batch_id <=> OLD\.correction_root_batch_id\) THEN\s+SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII correction root is immutable'/,
    );
    expect(trigger).toMatch(/OLD\.status = 'approved'[\s\S]*NEW\.status NOT IN \('approved','exported'\)/);
    expect(trigger).toMatch(/OLD\.status = 'exported'[\s\S]*NEW\.status NOT IN \('exported','filed'\)/);
    expect(trigger).toMatch(
      /OLD\.status = 'filed'[\s\S]*NEW\.status NOT IN \('filed','accepted','correction_required'\)/,
    );
    expect(trigger).toMatch(/first_exported_at[\s\S]*OLD\.status = 'approved'[\s\S]*NEW\.status = 'exported'/);
    expect(trigger).toMatch(/OLD\.status = 'superseded' AND NEW\.status <> 'superseded'/);
  });

  test('a routine code rollback cannot erase retained SNII evidence', () => {
    expect(rollback).toMatch(/retain|preserv|evidence/i);
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS snii_/);
    expect(rollback).not.toMatch(/DELETE\s+FROM\s+snii_/i);
  });
});
