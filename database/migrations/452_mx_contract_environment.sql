-- =============================================================================
-- Migration 452 — MX contract sandbox / production separation
-- =============================================================================
-- PROFECO does not provide FireISP with a test registry.  Sandbox mode is a
-- FireISP-only simulation lane whose records must never be mistaken for an
-- externally registered contrato de adhesion.  Production remains the lane
-- for the real external registration workflow.
--
-- Safety and history rules:
--   * Existing contract_templates_mx rows pre-date the sandbox concept and are
--     therefore backfilled to production, regardless of workflow status.
--   * New sources default to sandbox.  A sandbox source can only be draft or
--     sandbox_ready and cannot carry an official number/date.
--   * Source environment is immutable.  Moving to production means creating a
--     distinct production source, never promoting a simulated artifact.
--   * Contracts and signed documents snapshot the source environment.  A
--     composite FK prevents the snapshot from disagreeing with its source.
--   * Existing evidence hashes use canonical envelope version 2.  New
--     mode-bound evidence explicitly writes version 3 in the application, and
--     adding this column does not recompute or mutate any existing hash.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_452_mx_contract_environment;
DELIMITER //
CREATE PROCEDURE migration_452_mx_contract_environment()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'organization_mx_profiles'
       AND COLUMN_NAME = 'contract_environment'
  ) THEN
    ALTER TABLE organization_mx_profiles
      ADD COLUMN contract_environment ENUM('sandbox','production','legacy_pending')
        NOT NULL DEFAULT 'legacy_pending'
        COMMENT 'MX adhesion-contract lane; independent from the CFDI/PAC environment'
        AFTER carta_derechos_url;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'organization_mx_profiles'
       AND INDEX_NAME = 'idx_organization_mx_profiles_contract_environment'
  ) THEN
    ALTER TABLE organization_mx_profiles
      ADD KEY idx_organization_mx_profiles_contract_environment (contract_environment);
  END IF;

  -- ADD with a production default is deliberate: MySQL fills every existing
  -- row with production.  The default is changed to sandbox immediately after,
  -- so only sources created after this migration enter the simulation lane.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE contract_templates_mx
      ADD COLUMN environment ENUM('sandbox','production')
        NOT NULL DEFAULT 'production'
        COMMENT 'Immutable legal-evidence lane; sandbox is a FireISP simulation, production is externally registered workflow'
        AFTER organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'status'
       AND COLUMN_TYPE NOT LIKE '%sandbox_ready%'
  ) THEN
    ALTER TABLE contract_templates_mx
      MODIFY COLUMN status
        ENUM('draft','submitted','sandbox_ready','registered','expired','revoked')
        NOT NULL DEFAULT 'draft'
        COMMENT 'sandbox_ready is usable simulation text; registered is externally approved production text';
  END IF;

  -- Canonical post-migration default for newly created sources.  Do not
  -- redefine the column on a re-run: once the composite child FKs below exist,
  -- MySQL/MariaDB reject MODIFY of their referenced parent column.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'environment'
       -- MySQL exposes sandbox; MariaDB exposes the quoted literal 'sandbox'.
       AND COALESCE(COLUMN_DEFAULT, '') NOT IN ('sandbox', '''sandbox''')
  ) THEN
    ALTER TABLE contract_templates_mx
      MODIFY COLUMN environment ENUM('sandbox','production')
        NOT NULL DEFAULT 'sandbox'
        COMMENT 'Immutable legal-evidence lane; sandbox is a FireISP simulation, production is externally registered workflow';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND INDEX_NAME = 'uq_contract_templates_mx_id_environment'
  ) THEN
    ALTER TABLE contract_templates_mx
      ADD UNIQUE KEY uq_contract_templates_mx_id_environment (id, environment);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND INDEX_NAME = 'idx_contract_templates_mx_org_environment_status'
  ) THEN
    ALTER TABLE contract_templates_mx
      ADD KEY idx_contract_templates_mx_org_environment_status
        (organization_id, environment, status, deleted_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND CONSTRAINT_NAME = 'chk_contract_templates_mx_environment_status'
  ) THEN
    ALTER TABLE contract_templates_mx
      ADD CONSTRAINT chk_contract_templates_mx_environment_status CHECK (
        (
          environment = 'sandbox'
          AND status IN ('draft','sandbox_ready')
          AND ift_registration_number IS NULL
          AND registered_at IS NULL
        )
        OR
        (
          environment = 'production'
          AND status IN ('draft','submitted','registered','expired','revoked')
        )
      );
  END IF;

  -- The temporary legacy_pending value makes this backfill restart-safe.  An
  -- established org with any pre-452 source stays in the production workflow;
  -- an MX org without a source starts in sandbox.  On a re-run, deliberate
  -- sandbox orgs that happen to have a separately configured production source
  -- are not switched behind the operator's back.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'organization_mx_profiles'
       AND COLUMN_NAME = 'contract_environment'
       AND COLUMN_TYPE LIKE '%legacy_pending%'
  ) THEN
    UPDATE organization_mx_profiles profile
       SET profile.contract_environment = 'production'
     WHERE profile.contract_environment = 'legacy_pending'
       AND EXISTS (
         SELECT 1
           FROM contract_templates_mx source
          WHERE source.organization_id = profile.organization_id
            AND source.environment = 'production'
       );

    UPDATE organization_mx_profiles
       SET contract_environment = 'sandbox'
     WHERE contract_environment = 'legacy_pending';

    ALTER TABLE organization_mx_profiles
      MODIFY COLUMN contract_environment ENUM('sandbox','production')
        NOT NULL DEFAULT 'sandbox'
        COMMENT 'MX adhesion-contract lane; independent from the CFDI/PAC environment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND COLUMN_NAME = 'mx_contract_environment'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN mx_contract_environment ENUM('sandbox','production') NULL
        COMMENT 'Immutable environment snapshot of contract_template_mx_id; NULL for contracts without an MX source'
        AFTER contract_template_mx_id;
  END IF;

  UPDATE contracts c
  JOIN contract_templates_mx source ON source.id = c.contract_template_mx_id
     SET c.mx_contract_environment = source.environment
   WHERE c.mx_contract_environment IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND INDEX_NAME = 'idx_contracts_mx_source_environment'
  ) THEN
    ALTER TABLE contracts
      ADD KEY idx_contracts_mx_source_environment
        (contract_template_mx_id, mx_contract_environment);
  END IF;

  -- MariaDB rejects CHECK constraints over a column participating in a
  -- cascading/SET NULL FK. Provenance must never be cleared by deleting or
  -- renumbering its source anyway, so replace migration 078's FK first.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'fk_contracts_contract_template_mx'
       AND (DELETE_RULE <> 'RESTRICT' OR UPDATE_RULE <> 'RESTRICT')
  ) THEN
    ALTER TABLE contracts DROP FOREIGN KEY fk_contracts_contract_template_mx;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'fk_contracts_contract_template_mx'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT fk_contracts_contract_template_mx
        FOREIGN KEY (contract_template_mx_id)
        REFERENCES contract_templates_mx (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'chk_contracts_mx_environment_link'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT chk_contracts_mx_environment_link CHECK (
        (contract_template_mx_id IS NULL AND mx_contract_environment IS NULL)
        OR
        (contract_template_mx_id IS NOT NULL AND mx_contract_environment IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'fk_contracts_mx_source_environment'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT fk_contracts_mx_source_environment
        FOREIGN KEY (contract_template_mx_id, mx_contract_environment)
        REFERENCES contract_templates_mx (id, environment)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'evidence_format_version'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN evidence_format_version SMALLINT UNSIGNED NOT NULL DEFAULT 2
        COMMENT 'Canonical evidence-envelope version; legacy evidence is v2 and environment-bound evidence is v3'
        AFTER evidence_sha256;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_contract_environment'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN mx_contract_environment ENUM('sandbox','production') NULL
        COMMENT 'Immutable environment snapshot of contract_template_mx_id; NULL for documents without an MX source'
        AFTER contract_template_mx_id;
  END IF;

  UPDATE signed_documents d
  JOIN contract_templates_mx source ON source.id = d.contract_template_mx_id
     SET d.mx_contract_environment = source.environment
   WHERE d.mx_contract_environment IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_mx_source_environment'
  ) THEN
    ALTER TABLE signed_documents
      ADD KEY idx_signed_documents_mx_source_environment
        (contract_template_mx_id, mx_contract_environment);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_evidence_format_version'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT chk_signed_documents_evidence_format_version
        CHECK (evidence_format_version IN (2, 3));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_mx_environment_link'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT chk_signed_documents_mx_environment_link CHECK (
        (
          contract_template_mx_id IS NULL
          AND mx_contract_environment IS NULL
        )
        OR
        (
          contract_template_mx_id IS NOT NULL
          AND mx_contract_environment IS NOT NULL
          AND (
            mx_contract_environment = 'production'
            OR (
              mx_registration_number IS NULL
              AND mx_registered_at IS NULL
              AND evidence_format_version = 3
            )
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_mx_source_environment'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT fk_signed_documents_mx_source_environment
        FOREIGN KEY (contract_template_mx_id, mx_contract_environment)
        REFERENCES contract_templates_mx (id, environment)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END //
DELIMITER ;

CALL migration_452_mx_contract_environment();
DROP PROCEDURE IF EXISTS migration_452_mx_contract_environment;

-- Replace migration 087's locale-only contract guards with full provenance
-- classification. New MX contracts must freeze the exact organization-owned
-- source from the effective current lane; global contracts must remain
-- generic. The pair is immutable after INSERT, so direct SQL cannot relabel
-- history or initialize an unclassified legacy row behind the application's
-- switch/audit workflow.
DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_mx_template_bi$$
CREATE TRIGGER trg_contracts_mx_template_bi
BEFORE INSERT ON contracts
FOR EACH ROW
BEGIN
  DECLARE contract_org_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE contract_locale VARCHAR(10) DEFAULT NULL;
  DECLARE current_contract_environment VARCHAR(16) DEFAULT NULL;
  DECLARE source_org_id BIGINT UNSIGNED DEFAULT NULL;

  SELECT client.organization_id INTO contract_org_id
    FROM clients client WHERE client.id = NEW.client_id LIMIT 1;
  SET contract_org_id = COALESCE(NEW.organization_id, contract_org_id);

  SELECT organization_row.locale,
         CASE
           WHEN profile.contract_environment IS NOT NULL THEN profile.contract_environment
           WHEN EXISTS (
             SELECT 1 FROM contract_templates_mx legacy_source
              WHERE legacy_source.organization_id = organization_row.id
                AND legacy_source.environment = 'production'
           ) THEN 'production'
           ELSE 'sandbox'
         END
    INTO contract_locale, current_contract_environment
    FROM organizations organization_row
    LEFT JOIN organization_mx_profiles profile
      ON profile.organization_id = organization_row.id AND profile.deleted_at IS NULL
   WHERE organization_row.id = contract_org_id
   LIMIT 1
   FOR UPDATE;

  IF contract_locale = 'MX' THEN
    IF NEW.contract_template_mx_id IS NULL OR NEW.mx_contract_environment IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MX contracts require a classified contract source and environment';
    END IF;
    IF NEW.mx_contract_environment <> current_contract_environment THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MX contract environment must match the organization current contract environment';
    END IF;
    SELECT source.organization_id INTO source_org_id
      FROM contract_templates_mx source
     WHERE source.id = NEW.contract_template_mx_id
       AND source.environment = NEW.mx_contract_environment
       AND source.deleted_at IS NULL
       AND (
         (source.environment = 'sandbox'
          AND source.status = 'sandbox_ready'
          AND source.ift_registration_number IS NULL
          AND source.registered_at IS NULL)
         OR (source.environment = 'production'
          AND source.status = 'registered'
          AND source.ift_registration_number IS NOT NULL
          AND source.registered_at IS NOT NULL)
       )
       AND EXISTS (
         SELECT 1 FROM document_templates activation_template
          WHERE activation_template.organization_id = contract_org_id
            AND activation_template.contract_template_mx_id = source.id
            AND activation_template.template_type = 'activation_contract'
            AND activation_template.is_active = 1
            AND activation_template.deleted_at IS NULL
            AND BINARY activation_template.body_md = BINARY source.template_body
            AND NOT EXISTS (
              SELECT 1 FROM document_templates competing_template
              LEFT JOIN contract_templates_mx competing_source
                ON competing_source.id = competing_template.contract_template_mx_id
               WHERE competing_template.organization_id = contract_org_id
                 AND competing_template.template_type = 'activation_contract'
                 AND competing_template.is_active = 1
                 AND competing_template.deleted_at IS NULL
                 AND (competing_source.id IS NULL OR competing_source.environment = NEW.mx_contract_environment)
                 AND (competing_source.id IS NULL OR competing_source.id <> source.id)
            )
       )
     LIMIT 1;
    IF source_org_id IS NULL OR source_org_id <> contract_org_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MX contract source must belong to the contract organization';
    END IF;
  ELSEIF NEW.contract_template_mx_id IS NOT NULL OR NEW.mx_contract_environment IS NOT NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Global contracts cannot carry an MX contract source or environment';
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_contracts_mx_template_bu$$
CREATE TRIGGER trg_contracts_mx_template_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
  DECLARE contract_org_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE contract_locale VARCHAR(10) DEFAULT NULL;
  DECLARE source_org_id BIGINT UNSIGNED DEFAULT NULL;

  IF NOT (NEW.mx_contract_environment <=> OLD.mx_contract_environment) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Contract MX environment snapshot is immutable; create a new contract';
  END IF;

  IF OLD.contract_template_mx_id IS NOT NULL
     AND (
       NOT (NEW.organization_id <=> OLD.organization_id)
       OR NEW.client_id <> OLD.client_id
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Contract organization/client is immutable once MX provenance is frozen';
  END IF;

  IF NOT (NEW.contract_template_mx_id <=> OLD.contract_template_mx_id)
     AND (
       OLD.mx_contract_environment IS NULL
       OR OLD.status <> 'pending'
       OR OLD.first_activated_at IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM signed_documents document_history
          WHERE document_history.contract_id = OLD.id
       )
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Contract MX source can change only while pending, unsigned, and never activated';
  END IF;

  -- Revalidate current readiness only when deliberately repairing the source
  -- of a still-pending, unsigned contract.  A source may later expire, be
  -- revoked, or have its operational template retired; that must not brick
  -- cancellation, suspension, deletion, or other updates to historical rows.
  IF NOT (NEW.contract_template_mx_id <=> OLD.contract_template_mx_id) THEN
    IF NEW.contract_template_mx_id IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Contract MX source snapshot cannot be cleared';
    END IF;
    SELECT client.organization_id INTO contract_org_id
      FROM clients client WHERE client.id = NEW.client_id LIMIT 1;
    SET contract_org_id = COALESCE(NEW.organization_id, contract_org_id);
    SELECT organization_row.locale INTO contract_locale
      FROM organizations organization_row WHERE organization_row.id = contract_org_id LIMIT 1;
    SELECT source.organization_id INTO source_org_id
      FROM contract_templates_mx source
     WHERE source.id = NEW.contract_template_mx_id
       AND source.environment = NEW.mx_contract_environment
       AND source.deleted_at IS NULL
       AND (
         (source.environment = 'sandbox'
          AND source.status = 'sandbox_ready'
          AND source.ift_registration_number IS NULL
          AND source.registered_at IS NULL)
         OR (source.environment = 'production'
          AND source.status = 'registered'
          AND source.ift_registration_number IS NOT NULL
          AND source.registered_at IS NOT NULL)
       )
       AND EXISTS (
         SELECT 1 FROM document_templates activation_template
          WHERE activation_template.organization_id = contract_org_id
            AND activation_template.contract_template_mx_id = source.id
            AND activation_template.template_type = 'activation_contract'
            AND activation_template.is_active = 1
            AND activation_template.deleted_at IS NULL
            AND BINARY activation_template.body_md = BINARY source.template_body
            AND NOT EXISTS (
              SELECT 1 FROM document_templates competing_template
              LEFT JOIN contract_templates_mx competing_source
                ON competing_source.id = competing_template.contract_template_mx_id
               WHERE competing_template.organization_id = contract_org_id
                 AND competing_template.template_type = 'activation_contract'
                 AND competing_template.is_active = 1
                 AND competing_template.deleted_at IS NULL
                 AND (competing_source.id IS NULL OR competing_source.environment = NEW.mx_contract_environment)
                 AND (competing_source.id IS NULL OR competing_source.id <> source.id)
            )
       )
     LIMIT 1;
    IF contract_locale <> 'MX' OR source_org_id IS NULL OR source_org_id <> contract_org_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MX contract source must remain attached to its Mexican organization';
    END IF;
  END IF;
END$$

DELIMITER ;

-- A sandbox snapshot is permanent test provenance. After the organization
-- deliberately enters production, historical sandbox contracts may remain
-- visible but cannot be commissioned or restored into service. Keeping this
-- inside the existing status FSM protects every caller (HTTP, payment/dunning
-- automation, imports, and direct SQL) at the final write boundary. The rule
-- is asymmetric: a frozen production contract remains legally usable while
-- the switch is temporarily set to sandbox for new contracts.
DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$
CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
  DECLARE contract_org_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE current_org_locale VARCHAR(10) DEFAULT NULL;
  DECLARE current_mx_contract_environment VARCHAR(16) DEFAULT NULL;

  IF NEW.status != OLD.status THEN
    IF NOT (
           (OLD.status = 'pending'    AND NEW.status IN ('active', 'cancelled'))
        OR (OLD.status = 'active'     AND NEW.status IN ('expired', 'cancelled', 'suspended', 'terminated'))
        OR (OLD.status = 'suspended'  AND NEW.status IN ('pending', 'active', 'cancelled', 'terminated'))
        OR (OLD.status IN ('expired', 'cancelled', 'terminated') AND NEW.status IN ('pending', 'active'))
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Invalid contract status transition';
    END IF;
  END IF;

  IF NEW.status IN ('pending', 'active')
     AND (
       NEW.status != OLD.status
       OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
     )
  THEN
    -- A locking read is essential, not just an EXISTS check. It serializes
    -- this contract-first transition with the environment switch's profile
    -- lock and closes the terminal-contract/profile write-skew window for
    -- every caller, including payment automation and direct SQL.
    SET contract_org_id = OLD.organization_id;
    IF contract_org_id IS NULL THEN
      SELECT client.organization_id INTO contract_org_id
        FROM clients client WHERE client.id = OLD.client_id LIMIT 1;
    END IF;

    SELECT organization_row.locale,
           CASE
             WHEN profile.contract_environment IS NOT NULL
               THEN profile.contract_environment
             WHEN EXISTS (
               SELECT 1
                 FROM contract_templates_mx legacy_source
                WHERE legacy_source.organization_id = organization_row.id
                  AND legacy_source.environment = 'production'
             ) THEN 'production'
             ELSE 'sandbox'
           END
      INTO current_org_locale, current_mx_contract_environment
      FROM organizations organization_row
      LEFT JOIN organization_mx_profiles profile
        ON profile.organization_id = organization_row.id
       AND profile.deleted_at IS NULL
     WHERE organization_row.id = contract_org_id
     LIMIT 1
     FOR UPDATE;

    IF current_org_locale = 'MX'
       AND (OLD.contract_template_mx_id IS NULL OR OLD.mx_contract_environment IS NULL)
    THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MX contract renewal/activation requires a frozen contract source and environment; create a new classified MX contract';
    END IF;

    IF OLD.mx_contract_environment = 'sandbox'
       AND current_org_locale = 'MX'
       AND current_mx_contract_environment = 'production'
    THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Sandbox contract evidence cannot return to pending or active service in production; create a new production contract';
    END IF;
  END IF;
END$$

DELIMITER ;

-- An environment is legal provenance, not mutable workflow state.  Production
-- setup alongside sandbox therefore creates a second source instead of
-- promoting the simulated record in place.
DROP TRIGGER IF EXISTS trg_contract_templates_mx_environment_bu;
DELIMITER //
CREATE TRIGGER trg_contract_templates_mx_environment_bu
BEFORE UPDATE ON contract_templates_mx
FOR EACH ROW
BEGIN
  IF NEW.environment <> OLD.environment THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'contract_templates_mx.environment is immutable; create a separate source for the other environment';
  END IF;
END //
DELIMITER ;

-- Generated legal evidence freezes its source snapshot immediately, even
-- while the customer signature is still pending. Signing may upgrade the
-- canonical envelope from v2 to v3, but cannot relink or rewrite provenance.
DROP TRIGGER IF EXISTS trg_signed_documents_mx_snapshot_bu;
DELIMITER //
CREATE TRIGGER trg_signed_documents_mx_snapshot_bu
BEFORE UPDATE ON signed_documents
FOR EACH ROW
BEGIN
  IF NOT (NEW.contract_template_mx_id <=> OLD.contract_template_mx_id)
     OR NOT (NEW.mx_contract_environment <=> OLD.mx_contract_environment)
     OR NOT (NEW.mx_registration_number <=> OLD.mx_registration_number)
     OR NOT (NEW.mx_registered_at <=> OLD.mx_registered_at)
     OR NOT (NEW.mx_template_version <=> OLD.mx_template_version)
     OR NOT (NEW.mx_source_sha256 <=> OLD.mx_source_sha256)
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Signed-document MX source snapshot is immutable';
  END IF;
END //
DELIMITER ;
