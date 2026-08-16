-- =============================================================================
-- Migration 458 — MX SNII infrastructure reporting preparation and evidence
-- =============================================================================
-- This is deliberately a preparation workflow.  It generates pinned
-- preparation formats but does not submit data to the CRT or certify legal
-- compliance.
--
-- Safety properties:
--   * MX-only profile, backed by database triggers and an application gate.
--   * Operational infrastructure is never included automatically.  Registry
--     rows start unreviewed and only an explicit included decision is copied.
--   * Report batches are complete, immutable snapshots of all included rows.
--   * Generated artifacts, filing evidence and the tenant-local audit trail are
--     append-only.  Generating an artifact never marks a batch as filed.
--   * organization_id is mandatory on every table and composite foreign keys
--     prevent a child record from crossing tenant boundaries.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_458_concession_org_key;
DELIMITER //
CREATE PROCEDURE migration_458_concession_org_key()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'concession_titles'
       AND INDEX_NAME = 'uq_concession_titles_id_org'
  ) THEN
    ALTER TABLE concession_titles
      ADD UNIQUE KEY uq_concession_titles_id_org (id, organization_id);
  END IF;
END//
DELIMITER ;
CALL migration_458_concession_org_key();
DROP PROCEDURE IF EXISTS migration_458_concession_org_key;

CREATE TABLE IF NOT EXISTS snii_reporting_profiles (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id         BIGINT UNSIGNED NOT NULL,
  concession_title_id     BIGINT UNSIGNED NULL,
  concession_title_snapshot JSON NULL COMMENT 'Whitelisted title identity/state reviewed for this profile; notes excluded',
  concession_title_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  electronic_folio        VARCHAR(100) NOT NULL,
  authority_code          VARCHAR(20) NOT NULL DEFAULT 'CRT',
  legal_basis             VARCHAR(100) NOT NULL DEFAULT 'LMTR_ARTICLES_174_181',
  source_channel          ENUM('crt_ventanilla_current') NOT NULL,
  source_attestation_reference VARCHAR(500) NOT NULL,
  adapter_reconciliation_reference VARCHAR(500) NOT NULL COMMENT 'Operator review tying this embedded adapter to the pinned current Ventanilla package',
  adapter_reconciliation_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_catalog_version VARCHAR(100) NOT NULL,
  adapter_reconciled_by  BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  adapter_reconciled_at  DATETIME(3) NOT NULL,
  template_version        VARCHAR(100) NOT NULL,
  template_source_url     VARCHAR(1000) NOT NULL,
  template_sha256         CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_effective_date DATE NULL,
  dictionary_version      VARCHAR(100) NOT NULL,
  dictionary_source_url   VARCHAR(1000) NOT NULL,
  dictionary_sha256       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  annex_v_version         VARCHAR(100) NOT NULL,
  annex_v_source_url      VARCHAR(1000) NOT NULL,
  annex_v_sha256          CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  official_sources_reviewed_by BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  official_sources_reviewed_at DATETIME(3) NOT NULL,
  source_freshness_days   SMALLINT UNSIGNED NOT NULL DEFAULT 180,
  subject_applicability   ENUM('unreviewed','applicable','not_applicable') NOT NULL DEFAULT 'unreviewed',
  applicability_basis     VARCHAR(2000) NULL,
  external_decision_reference VARCHAR(500) NULL,
  applicability_decided_by BIGINT UNSIGNED NULL COMMENT 'Primary/control-plane user id; retained without FK',
  applicability_decided_at DATETIME(3) NULL,
  created_by              BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  updated_by              BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_profiles_org (organization_id),
  UNIQUE KEY uq_snii_profiles_id_org (id, organization_id),
  KEY idx_snii_profiles_concession (concession_title_id),
  CONSTRAINT fk_snii_profiles_org FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_profiles_concession_org FOREIGN KEY (concession_title_id, organization_id)
    REFERENCES concession_titles(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snii_profiles_freshness CHECK (source_freshness_days BETWEEN 1 AND 3650),
  CONSTRAINT chk_snii_profiles_authority CHECK (authority_code = 'CRT'),
  CONSTRAINT chk_snii_profiles_legal_basis CHECK (legal_basis = 'LMTR_ARTICLES_174_181'),
  CONSTRAINT chk_snii_profiles_reconciliation_time CHECK (
    adapter_reconciled_at >= official_sources_reviewed_at
  ),
  CONSTRAINT chk_snii_profiles_title_snapshot CHECK (
    (concession_title_id IS NULL AND concession_title_snapshot IS NULL
      AND concession_title_sha256 IS NULL)
    OR (concession_title_id IS NOT NULL AND concession_title_snapshot IS NOT NULL
      AND concession_title_sha256 IS NOT NULL)
  ),
  CONSTRAINT chk_snii_profiles_applicability CHECK (
    subject_applicability = 'unreviewed'
    OR (NULLIF(TRIM(applicability_basis), '') IS NOT NULL
        AND NULLIF(TRIM(external_decision_reference), '') IS NOT NULL
        AND applicability_decided_by IS NOT NULL
        AND applicability_decided_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='MX-only SNII preparation profile; not proof of filing or compliance';

CREATE TABLE IF NOT EXISTS snii_element_applicability (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  profile_id          BIGINT UNSIGNED NOT NULL,
  element_type        VARCHAR(64) NOT NULL,
  applicability       ENUM('unreviewed','applicable','not_applicable') NOT NULL DEFAULT 'unreviewed',
  rationale           VARCHAR(1000) NULL,
  population_status   ENUM('unreviewed','has_assets','zero_population') NOT NULL DEFAULT 'unreviewed',
  population_evidence_reference VARCHAR(500) NULL,
  population_reviewed_by BIGINT UNSIGNED NULL COMMENT 'Primary/control-plane user id; retained without FK',
  population_reviewed_at DATETIME(3) NULL,
  reviewed_by         BIGINT UNSIGNED NULL COMMENT 'Primary/control-plane user id; retained without FK',
  reviewed_at         DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_applicability_profile_type (profile_id, element_type),
  KEY idx_snii_applicability_org_state (organization_id, applicability),
  CONSTRAINT fk_snii_applicability_profile_org FOREIGN KEY (profile_id, organization_id)
    REFERENCES snii_reporting_profiles(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snii_applicability_rationale CHECK (
    applicability <> 'not_applicable' OR NULLIF(TRIM(rationale), '') IS NOT NULL
  ),
  CONSTRAINT chk_snii_applicability_population CHECK (
    (applicability <> 'applicable' AND population_status = 'unreviewed'
      AND population_evidence_reference IS NULL
      AND population_reviewed_by IS NULL AND population_reviewed_at IS NULL)
    OR (applicability = 'applicable' AND population_status IN ('has_assets','zero_population')
      AND population_reviewed_by IS NOT NULL AND population_reviewed_at IS NOT NULL
      AND (population_status <> 'zero_population'
        OR NULLIF(TRIM(population_evidence_reference), '') IS NOT NULL))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Explicit per-element applicability decision; defaults fail-closed';

CREATE TABLE IF NOT EXISTS snii_asset_registry (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  profile_id            BIGINT UNSIGNED NOT NULL,
  source_type           ENUM('site','device','network_link','fiber_route','infrastructure_point','manual') NOT NULL,
  source_id             BIGINT UNSIGNED NULL,
  element_type          VARCHAR(64) NOT NULL,
  decision              ENUM('unreviewed','included','excluded') NOT NULL DEFAULT 'unreviewed',
  approval_status       ENUM('not_required','pending','approved') NOT NULL DEFAULT 'not_required',
  exclusion_reason      ENUM('dummy','test','cpe','customer_drop','duplicate','not_applicable','reported_by_owner','other') NULL,
  decision_evidence_reference VARCHAR(500) NULL,
  official_code         VARCHAR(191) NULL,
  ownership             ENUM('owned','leased','third_party') NULL,
  owner_name            VARCHAR(255) NULL,
  field_overrides       JSON NULL,
  manual_payload        JSON NULL,
  reviewed_payload      JSON NULL COMMENT 'Last explicitly classified source payload; preserved if the operational row is later removed',
  source_snapshot_hash  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  classification_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Hash of the exact decision and reviewed payload shown to the approver',
  classification_revision INT UNSIGNED NOT NULL DEFAULT 0,
  source_updated_at     DATETIME(3) NULL,
  classified_by         BIGINT UNSIGNED NULL COMMENT 'Primary/control-plane user id; retained without FK',
  classified_at         DATETIME(3) NULL,
  approved_by           BIGINT UNSIGNED NULL COMMENT 'Separate primary/control-plane user id; retained without FK',
  approved_at           DATETIME(3) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_registry_id_org (id, organization_id),
  UNIQUE KEY uq_snii_registry_source_type (organization_id, source_type, source_id, element_type),
  KEY idx_snii_registry_profile_decision (profile_id, decision, approval_status),
  KEY idx_snii_registry_org_element (organization_id, element_type),
  CONSTRAINT fk_snii_registry_profile_org FOREIGN KEY (profile_id, organization_id)
    REFERENCES snii_reporting_profiles(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snii_registry_source CHECK (
    (source_type = 'manual' AND source_id IS NULL AND manual_payload IS NOT NULL)
    OR (source_type <> 'manual' AND source_id IS NOT NULL AND manual_payload IS NULL)
  ),
  CONSTRAINT chk_snii_registry_exclusion CHECK (
    (decision = 'excluded' AND exclusion_reason IS NOT NULL)
    OR (decision <> 'excluded' AND exclusion_reason IS NULL)
  ),
  CONSTRAINT chk_snii_registry_review CHECK (
    (decision = 'unreviewed' AND approval_status = 'not_required'
      AND classified_by IS NULL AND classified_at IS NULL
      AND approved_by IS NULL AND approved_at IS NULL)
      AND reviewed_payload IS NULL AND source_snapshot_hash IS NULL
      AND classification_hash IS NULL AND classification_revision = 0
    OR (decision <> 'unreviewed' AND approval_status IN ('pending','approved')
      AND classified_by IS NOT NULL AND classified_at IS NOT NULL
      AND reviewed_payload IS NOT NULL AND source_snapshot_hash IS NOT NULL
      AND classification_hash IS NOT NULL AND classification_revision >= 1
      AND NULLIF(TRIM(decision_evidence_reference), '') IS NOT NULL)
  ),
  CONSTRAINT chk_snii_registry_approval CHECK (
    approval_status <> 'approved'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> classified_by)
  ),
  CONSTRAINT chk_snii_registry_third_party_owner CHECK (
    ownership <> 'third_party' OR NULLIF(TRIM(owner_name), '') IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Explicit SNII asset decisions; operational records are never auto-included';

CREATE TABLE IF NOT EXISTS snii_report_batches (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  profile_id            BIGINT UNSIGNED NOT NULL,
  concession_title_id   BIGINT UNSIGNED NULL COMMENT 'Concession-title identity frozen with this preparation batch',
  concession_title_snapshot JSON NULL COMMENT 'Whitelisted title identity/state frozen with this preparation batch',
  concession_title_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  supersedes_batch_id   BIGINT UNSIGNED NULL COMMENT 'Direct retained predecessor for an internal replacement or authority correction',
  correction_root_batch_id BIGINT UNSIGNED NULL COMMENT 'NULL until authority correction; points to correction_required root and is retained across internal replacements',
  supersession_reason   VARCHAR(500) NULL COMMENT 'Reason/reference explaining every retained replacement revision',
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  filing_kind           ENUM('initial','update','voluntary') NOT NULL,
  filing_window         ENUM('initial','first_semiannual','second_combined','anytime') NOT NULL,
  filing_year           SMALLINT UNSIGNED NOT NULL,
  filing_frequency      ENUM('initial','semiannual','annual_and_semiannual','voluntary') NOT NULL,
  full_load             TINYINT(1) NOT NULL DEFAULT 1,
  revision_no           SMALLINT UNSIGNED NOT NULL,
  status                ENUM('draft','validated','approved','exported','filed','correction_required','accepted','superseded') NOT NULL DEFAULT 'draft',
  catalog_version       VARCHAR(100) NOT NULL,
  element_types_snapshot JSON NOT NULL COMMENT 'All applicable object files due in this complete filing window, including zero-row files',
  element_contract_snapshot JSON NOT NULL COMMENT 'Immutable exact headers, constraints, geometry and filenames used by this batch',
  applicability_snapshot JSON NOT NULL COMMENT 'Immutable subject and all per-element legal review decisions/provenance',
  source_channel        ENUM('crt_ventanilla_current') NOT NULL,
  source_attestation_reference VARCHAR(500) NOT NULL,
  official_sources_reviewed_by BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  official_sources_reviewed_at DATETIME(3) NOT NULL,
  source_freshness_days SMALLINT UNSIGNED NOT NULL,
  adapter_reconciliation_reference VARCHAR(500) NOT NULL,
  adapter_reconciliation_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_catalog_version VARCHAR(100) NOT NULL,
  adapter_reconciled_by BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  adapter_reconciled_at DATETIME(3) NOT NULL,
  template_version      VARCHAR(100) NOT NULL,
  template_source_url   VARCHAR(1000) NOT NULL,
  template_sha256       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_effective_date DATE NULL,
  dictionary_version    VARCHAR(100) NOT NULL,
  dictionary_source_url VARCHAR(1000) NOT NULL,
  dictionary_sha256     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  annex_v_version       VARCHAR(100) NOT NULL,
  annex_v_source_url    VARCHAR(1000) NOT NULL,
  annex_v_sha256        CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legal_basis           VARCHAR(100) NOT NULL,
  electronic_folio      VARCHAR(100) NOT NULL,
  item_count            INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot_hash         CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  validation_result     JSON NULL,
  validated_at          DATETIME(3) NULL,
  approved_by           BIGINT UNSIGNED NULL COMMENT 'Primary/control-plane user id; retained without FK',
  approved_at           DATETIME(3) NULL,
  first_exported_at     DATETIME(3) NULL,
  created_by            BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_batches_id_org (id, organization_id),
  UNIQUE KEY uq_snii_batches_period_revision
    (profile_id, filing_kind, filing_year, filing_window, period_start, period_end,
      filing_frequency, revision_no),
  UNIQUE KEY uq_snii_batches_supersedes (supersedes_batch_id),
  KEY idx_snii_batches_org_status (organization_id, status, created_at),
  KEY idx_snii_batches_concession (concession_title_id),
  KEY idx_snii_batches_correction_root_org (correction_root_batch_id, organization_id),
  CONSTRAINT fk_snii_batches_profile_org FOREIGN KEY (profile_id, organization_id)
    REFERENCES snii_reporting_profiles(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_batches_concession_org FOREIGN KEY (concession_title_id, organization_id)
    REFERENCES concession_titles(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_batches_supersedes_org FOREIGN KEY (supersedes_batch_id, organization_id)
    REFERENCES snii_report_batches(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_batches_correction_root_org FOREIGN KEY (correction_root_batch_id, organization_id)
    REFERENCES snii_report_batches(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snii_batches_period CHECK (period_end >= period_start),
  CONSTRAINT chk_snii_batches_revision CHECK (revision_no >= 1),
  CONSTRAINT chk_snii_batches_lineage CHECK (
    (revision_no = 1 AND supersedes_batch_id IS NULL AND correction_root_batch_id IS NULL
      AND supersession_reason IS NULL)
    OR (revision_no > 1 AND supersedes_batch_id IS NOT NULL
        AND NULLIF(TRIM(supersession_reason), '') IS NOT NULL)
  ),
  CONSTRAINT chk_snii_batches_year CHECK (filing_year BETWEEN 2000 AND 2100),
  CONSTRAINT chk_snii_batches_full_load CHECK (full_load = 1),
  CONSTRAINT chk_snii_batches_freshness CHECK (source_freshness_days BETWEEN 1 AND 3650),
  CONSTRAINT chk_snii_batches_title_snapshot CHECK (
    (concession_title_id IS NULL AND concession_title_snapshot IS NULL
      AND concession_title_sha256 IS NULL)
    OR (concession_title_id IS NOT NULL AND concession_title_snapshot IS NOT NULL
      AND concession_title_sha256 IS NOT NULL)
  ),
  CONSTRAINT chk_snii_batches_separation CHECK (approved_by IS NULL OR approved_by <> created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Versioned full-load SNII preparation snapshots; export is not filing';

CREATE TABLE IF NOT EXISTS snii_report_items (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  batch_id              BIGINT UNSIGNED NOT NULL,
  registry_asset_id     BIGINT UNSIGNED NOT NULL,
  element_type          VARCHAR(64) NOT NULL,
  official_code         VARCHAR(191) NULL,
  source_type           ENUM('site','device','network_link','fiber_route','infrastructure_point','manual') NOT NULL,
  source_id             BIGINT UNSIGNED NULL,
  snapshot_payload      JSON NOT NULL,
  payload_hash          CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  validation_errors     JSON NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_items_batch_asset (batch_id, registry_asset_id),
  KEY idx_snii_items_batch_element (batch_id, element_type),
  CONSTRAINT fk_snii_items_batch_org FOREIGN KEY (batch_id, organization_id)
    REFERENCES snii_report_batches(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_items_registry_org FOREIGN KEY (registry_asset_id, organization_id)
    REFERENCES snii_asset_registry(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable per-asset full-load report snapshots';

CREATE TABLE IF NOT EXISTS snii_report_artifacts (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  batch_id            BIGINT UNSIGNED NOT NULL,
  element_type        VARCHAR(64) NOT NULL,
  format              ENUM('csv','kml') NOT NULL,
  file_name           VARCHAR(255) NOT NULL,
  mime_type           VARCHAR(100) NOT NULL,
  content_text        LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  content_sha256      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_size           BIGINT UNSIGNED NOT NULL,
  catalog_version     VARCHAR(100) NOT NULL,
  official_template_filename VARCHAR(255) NOT NULL,
  source_classification ENUM('historical_adapter_reconciled','official_template','official_dictionary','official_annex_v') NOT NULL,
  official_source_url VARCHAR(1000) NOT NULL,
  official_source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_reconciliation_reference VARCHAR(500) NOT NULL,
  adapter_reconciliation_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_reconciled_at DATETIME(3) NOT NULL,
  generator_version   VARCHAR(100) NOT NULL,
  generated_by        BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  generated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_artifacts_batch_type_format (batch_id, element_type, format),
  KEY idx_snii_artifacts_org_generated (organization_id, generated_at),
  CONSTRAINT fk_snii_artifacts_batch_org FOREIGN KEY (batch_id, organization_id)
    REFERENCES snii_report_batches(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable deterministic preparation exports; not authority submissions';

CREATE TABLE IF NOT EXISTS snii_evidence_uploads (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  file_name             VARCHAR(255) NOT NULL,
  mime_type             VARCHAR(100) NOT NULL,
  byte_size             BIGINT UNSIGNED NOT NULL,
  content_sha256        CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evidence_content      LONGBLOB NOT NULL COMMENT 'Immutable exact bytes uploaded for filing evidence',
  uploaded_by           BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  uploaded_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_evidence_upload_id_org (id, organization_id),
  KEY idx_snii_evidence_upload_org_time (organization_id, uploaded_at, id),
  CONSTRAINT fk_snii_evidence_upload_org FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snii_evidence_upload_size CHECK (byte_size BETWEEN 1 AND 10485760)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable tenant-local SNII filing evidence uploads';

CREATE TABLE IF NOT EXISTS snii_filing_events (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  batch_id              BIGINT UNSIGNED NOT NULL,
  event_type            ENUM('submitted','acuse_received','accepted','rejected','correction_requested','corrected_submission') NOT NULL,
  attempt_no            SMALLINT UNSIGNED NOT NULL,
  occurred_at           DATETIME(3) NOT NULL,
  occurred_timezone     VARCHAR(64) NOT NULL,
  authority_reference   VARCHAR(191) NOT NULL,
  evidence_upload_id    BIGINT UNSIGNED NOT NULL,
  evidence_file_name    VARCHAR(255) NOT NULL,
  evidence_mime_type    VARCHAR(100) NOT NULL,
  evidence_byte_size    BIGINT UNSIGNED NOT NULL,
  evidence_content      LONGBLOB NOT NULL COMMENT 'Immutable exact submitted/acuse evidence bytes',
  evidence_sha256       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notes                 VARCHAR(2000) NULL,
  event_hash            CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by            BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snii_filing_event_hash (organization_id, event_hash),
  UNIQUE KEY uq_snii_filing_attempt_event (batch_id, attempt_no, event_type),
  KEY idx_snii_filing_batch_time (batch_id, occurred_at, id),
  CONSTRAINT fk_snii_filing_batch_org FOREIGN KEY (batch_id, organization_id)
    REFERENCES snii_report_batches(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snii_filing_evidence_org FOREIGN KEY (evidence_upload_id, organization_id)
    REFERENCES snii_evidence_uploads(id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable operator-recorded filing and authority evidence; never inferred from export';

CREATE TABLE IF NOT EXISTS snii_audit_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   BIGINT UNSIGNED NOT NULL,
  actor_user_id     BIGINT UNSIGNED NOT NULL COMMENT 'Primary/control-plane user id; retained without FK',
  action            VARCHAR(100) NOT NULL,
  entity_type       VARCHAR(64) NOT NULL,
  entity_id         BIGINT UNSIGNED NULL,
  details           JSON NOT NULL,
  ip_address        VARCHAR(45) NULL,
  user_agent        VARCHAR(500) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_snii_audit_org_time (organization_id, created_at, id),
  KEY idx_snii_audit_entity (organization_id, entity_type, entity_id, created_at),
  CONSTRAINT fk_snii_audit_org FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Fail-closed tenant-local append-only audit for SNII preparation';

-- Permission definitions are retained by rollback so historical grants and
-- audit records never become dangling labels.
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.view', 'View MX SNII preparation profiles, registry and batches', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.view');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.review', 'Review SNII applicability and explicit asset inclusion decisions', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.review');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.prepare', 'Create and validate immutable SNII preparation batches', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.prepare');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.approve', 'Approve an SNII preparation snapshot', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.approve');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.export', 'Generate and download restricted SNII geolocation artifacts', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.export');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.file', 'Record evidence-backed CRT filing and response events', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.file');
INSERT INTO permissions (name, description, module)
SELECT 'snii_reporting.evidence', 'Download audited immutable SNII filing evidence', 'snii_reporting'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snii_reporting.evidence');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.name IN ('snii_reporting.view','snii_reporting.review','snii_reporting.prepare',
                'snii_reporting.approve','snii_reporting.export','snii_reporting.file',
                'snii_reporting.evidence')
WHERE r.name IN ('admin','super_admin') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.name = 'snii_reporting.view'
WHERE r.name IN ('readonly','auditor') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.name = 'snii_reporting.evidence'
WHERE r.name = 'auditor' AND r.deleted_at IS NULL;

DELIMITER //

DROP TRIGGER IF EXISTS trg_snii_profiles_mx_bi//
CREATE TRIGGER trg_snii_profiles_mx_bi
BEFORE INSERT ON snii_reporting_profiles
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.locale = 'MX'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'snii_reporting_profiles requires organization locale MX';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_registry_approval_bu//
CREATE TRIGGER trg_snii_registry_approval_bu
BEFORE UPDATE ON snii_asset_registry
FOR EACH ROW
BEGIN
  IF OLD.approval_status = 'approved'
     AND NEW.approval_status = 'approved'
     AND (NOT (NEW.element_type <=> OLD.element_type)
       OR NOT (NEW.decision <=> OLD.decision)
       OR NOT (NEW.exclusion_reason <=> OLD.exclusion_reason)
       OR NOT (NEW.decision_evidence_reference <=> OLD.decision_evidence_reference)
       OR NOT (NEW.official_code <=> OLD.official_code)
       OR NOT (NEW.ownership <=> OLD.ownership)
       OR NOT (NEW.owner_name <=> OLD.owner_name)
       OR NOT (NEW.field_overrides <=> OLD.field_overrides)
       OR NOT (NEW.manual_payload <=> OLD.manual_payload)
       OR NOT (NEW.reviewed_payload <=> OLD.reviewed_payload)
       OR NOT (NEW.source_snapshot_hash <=> OLD.source_snapshot_hash)
       OR NOT (NEW.classification_hash <=> OLD.classification_hash)
       OR NOT (NEW.classification_revision <=> OLD.classification_revision)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Changed SNII classifications require fresh approval';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_profiles_mx_bu//
CREATE TRIGGER trg_snii_profiles_mx_bu
BEFORE UPDATE ON snii_reporting_profiles
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.locale = 'MX'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'snii_reporting_profiles requires organization locale MX';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_organizations_snii_locale_bu//
CREATE TRIGGER trg_organizations_snii_locale_bu
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
  IF OLD.locale = 'MX' AND NEW.locale <> 'MX' AND EXISTS (
    SELECT 1 FROM snii_reporting_profiles p WHERE p.organization_id = OLD.id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot leave MX locale while an SNII reporting profile exists';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_registry_identity_bu//
CREATE TRIGGER trg_snii_registry_identity_bu
BEFORE UPDATE ON snii_asset_registry
FOR EACH ROW
BEGIN
  IF NOT (NEW.organization_id <=> OLD.organization_id)
     OR NOT (NEW.profile_id <=> OLD.profile_id)
     OR NOT (NEW.source_type <=> OLD.source_type)
     OR NOT (NEW.source_id <=> OLD.source_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII registry source identity is immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_batches_snapshot_bu//
CREATE TRIGGER trg_snii_batches_snapshot_bu
BEFORE UPDATE ON snii_report_batches
FOR EACH ROW
BEGIN
  IF NOT (NEW.correction_root_batch_id <=> OLD.correction_root_batch_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII correction root is immutable';
  END IF;

  IF OLD.status IN ('approved','exported','filed','correction_required','accepted','superseded')
     AND (
       NOT (NEW.organization_id <=> OLD.organization_id)
       OR NOT (NEW.profile_id <=> OLD.profile_id)
       OR NOT (NEW.concession_title_id <=> OLD.concession_title_id)
       OR NOT (NEW.concession_title_snapshot <=> OLD.concession_title_snapshot)
       OR NOT (NEW.concession_title_sha256 <=> OLD.concession_title_sha256)
       OR NOT (NEW.supersedes_batch_id <=> OLD.supersedes_batch_id)
       OR NOT (NEW.correction_root_batch_id <=> OLD.correction_root_batch_id)
       OR NOT (NEW.supersession_reason <=> OLD.supersession_reason)
       OR NOT (NEW.period_start <=> OLD.period_start)
       OR NOT (NEW.period_end <=> OLD.period_end)
       OR NOT (NEW.filing_kind <=> OLD.filing_kind)
       OR NOT (NEW.filing_window <=> OLD.filing_window)
       OR NOT (NEW.filing_year <=> OLD.filing_year)
       OR NOT (NEW.filing_frequency <=> OLD.filing_frequency)
       OR NOT (NEW.full_load <=> OLD.full_load)
       OR NOT (NEW.revision_no <=> OLD.revision_no)
       OR NOT (NEW.catalog_version <=> OLD.catalog_version)
       OR NOT (NEW.element_types_snapshot <=> OLD.element_types_snapshot)
       OR NOT (NEW.element_contract_snapshot <=> OLD.element_contract_snapshot)
       OR NOT (NEW.applicability_snapshot <=> OLD.applicability_snapshot)
       OR NOT (NEW.source_channel <=> OLD.source_channel)
       OR NOT (NEW.source_attestation_reference <=> OLD.source_attestation_reference)
       OR NOT (NEW.official_sources_reviewed_by <=> OLD.official_sources_reviewed_by)
       OR NOT (NEW.official_sources_reviewed_at <=> OLD.official_sources_reviewed_at)
       OR NOT (NEW.source_freshness_days <=> OLD.source_freshness_days)
       OR NOT (NEW.adapter_reconciliation_reference <=> OLD.adapter_reconciliation_reference)
       OR NOT (NEW.adapter_reconciliation_sha256 <=> OLD.adapter_reconciliation_sha256)
       OR NOT (NEW.adapter_catalog_version <=> OLD.adapter_catalog_version)
       OR NOT (NEW.adapter_reconciled_by <=> OLD.adapter_reconciled_by)
       OR NOT (NEW.adapter_reconciled_at <=> OLD.adapter_reconciled_at)
       OR NOT (NEW.template_version <=> OLD.template_version)
       OR NOT (NEW.template_source_url <=> OLD.template_source_url)
       OR NOT (NEW.template_sha256 <=> OLD.template_sha256)
       OR NOT (NEW.template_effective_date <=> OLD.template_effective_date)
       OR NOT (NEW.dictionary_version <=> OLD.dictionary_version)
       OR NOT (NEW.dictionary_source_url <=> OLD.dictionary_source_url)
       OR NOT (NEW.dictionary_sha256 <=> OLD.dictionary_sha256)
       OR NOT (NEW.annex_v_version <=> OLD.annex_v_version)
       OR NOT (NEW.annex_v_source_url <=> OLD.annex_v_source_url)
       OR NOT (NEW.annex_v_sha256 <=> OLD.annex_v_sha256)
       OR NOT (NEW.legal_basis <=> OLD.legal_basis)
       OR NOT (NEW.electronic_folio <=> OLD.electronic_folio)
       OR NOT (NEW.item_count <=> OLD.item_count)
       OR NOT (NEW.snapshot_hash <=> OLD.snapshot_hash)
       OR NOT (NEW.validation_result <=> OLD.validation_result)
       OR NOT (NEW.validated_at <=> OLD.validated_at)
       OR NOT (NEW.approved_by <=> OLD.approved_by)
       OR NOT (NEW.approved_at <=> OLD.approved_at)
       OR NOT (NEW.created_by <=> OLD.created_by)
       OR NOT (NEW.created_at <=> OLD.created_at)
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved SNII batch snapshot fields are immutable';
  END IF;
  IF (OLD.status = 'approved' AND NEW.status NOT IN ('approved','exported'))
     OR (OLD.status = 'exported' AND NEW.status NOT IN ('exported','filed'))
     OR (OLD.status = 'filed'
         AND NEW.status NOT IN ('filed','accepted','correction_required'))
     OR (OLD.status = 'accepted' AND NEW.status <> 'accepted')
     OR (OLD.status = 'correction_required' AND NEW.status <> 'correction_required')
     OR (OLD.status = 'superseded' AND NEW.status <> 'superseded') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII batch status transition is not forward-only';
  END IF;
  IF NOT (NEW.first_exported_at <=> OLD.first_exported_at)
     AND NOT (OLD.first_exported_at IS NULL AND NEW.first_exported_at IS NOT NULL
              AND OLD.status = 'approved' AND NEW.status = 'exported') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII first export timestamp is immutable';
  END IF;
  IF NEW.status IN ('exported','filed','accepted','correction_required')
     AND NEW.first_exported_at IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exported SNII batches require first_exported_at';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_batches_bd//
CREATE TRIGGER trg_snii_batches_bd BEFORE DELETE ON snii_report_batches FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report batches are immutable';
END//

DROP TRIGGER IF EXISTS trg_snii_items_bi//
CREATE TRIGGER trg_snii_items_bi
BEFORE INSERT ON snii_report_items
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM snii_report_batches b
     WHERE b.id = NEW.batch_id AND b.organization_id = NEW.organization_id AND b.status = 'draft'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report items may only be inserted into a draft batch';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_snii_items_bu//
CREATE TRIGGER trg_snii_items_bu BEFORE UPDATE ON snii_report_items FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report items are immutable';
END//
DROP TRIGGER IF EXISTS trg_snii_items_bd//
CREATE TRIGGER trg_snii_items_bd BEFORE DELETE ON snii_report_items FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report items are immutable';
END//

DROP TRIGGER IF EXISTS trg_snii_artifacts_bu//
CREATE TRIGGER trg_snii_artifacts_bu BEFORE UPDATE ON snii_report_artifacts FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report artifacts are immutable';
END//
DROP TRIGGER IF EXISTS trg_snii_artifacts_bd//
CREATE TRIGGER trg_snii_artifacts_bd BEFORE DELETE ON snii_report_artifacts FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII report artifacts are immutable';
END//

DROP TRIGGER IF EXISTS trg_snii_filing_bu//
CREATE TRIGGER trg_snii_filing_bu BEFORE UPDATE ON snii_filing_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII filing evidence is immutable';
END//

DROP TRIGGER IF EXISTS trg_snii_evidence_upload_bu//
CREATE TRIGGER trg_snii_evidence_upload_bu BEFORE UPDATE ON snii_evidence_uploads FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII evidence uploads are immutable';
END//
DROP TRIGGER IF EXISTS trg_snii_evidence_upload_bd//
CREATE TRIGGER trg_snii_evidence_upload_bd BEFORE DELETE ON snii_evidence_uploads FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII evidence uploads are immutable';
END//
DROP TRIGGER IF EXISTS trg_snii_filing_bd//
CREATE TRIGGER trg_snii_filing_bd BEFORE DELETE ON snii_filing_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII filing evidence is immutable';
END//

DROP TRIGGER IF EXISTS trg_snii_audit_bu//
CREATE TRIGGER trg_snii_audit_bu BEFORE UPDATE ON snii_audit_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII audit events are immutable';
END//
DROP TRIGGER IF EXISTS trg_snii_audit_bd//
CREATE TRIGGER trg_snii_audit_bd BEFORE DELETE ON snii_audit_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNII audit events are immutable';
END//

DELIMITER ;
