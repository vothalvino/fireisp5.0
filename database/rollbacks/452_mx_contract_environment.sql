-- Rollback for migration 452 — MX contract sandbox / production separation.
--
-- This rollback is safe only while migration 452 remains unused configuration.
-- It fails closed before destructive DDL when v3 signing evidence exists or a
-- sandbox source has been linked into an operational/history row.  Removing
-- either classifier in those cases would make evidence unverifiable or erase
-- its sandbox provenance.  When the guards pass, unreferenced sandbox-ready
-- sources become drafts before the status ENUM is narrowed.

-- Run the evidence preflight while the environment immutability trigger and all
-- migration-452 columns are still intact.  INFORMATION_SCHEMA guards preserve
-- restart safety when this rollback is re-run after a prior successful run.
DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment_preflight;
DELIMITER //
CREATE PROCEDURE rollback_452_mx_contract_environment_preflight()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'evidence_format_version'
  ) THEN
    IF EXISTS (
      SELECT 1
        FROM signed_documents
       WHERE evidence_format_version = 3
         AND (evidence_sha256 IS NOT NULL OR status = 'signed')
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Rollback 452 refused: durable v3 signed-document evidence depends on evidence_format_version';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'environment'
  ) THEN
    IF EXISTS (
      SELECT 1
        FROM contract_templates_mx source
       WHERE source.environment = 'sandbox'
         AND (
           EXISTS (
             SELECT 1 FROM document_templates dt
              WHERE dt.contract_template_mx_id = source.id
           )
           OR EXISTS (
             SELECT 1 FROM contracts c
              WHERE c.contract_template_mx_id = source.id
           )
           OR EXISTS (
             SELECT 1 FROM signed_documents sd
              WHERE sd.contract_template_mx_id = source.id
           )
         )
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Rollback 452 refused: a sandbox contract source is referenced by operational or evidence history';
    END IF;
  END IF;
END //
DELIMITER ;

CALL rollback_452_mx_contract_environment_preflight();
DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment_preflight;

DROP TRIGGER IF EXISTS trg_contract_templates_mx_environment_bu;
DROP TRIGGER IF EXISTS trg_signed_documents_mx_snapshot_bu;

-- Restore the migration-450 FSM before removing the environment snapshot it
-- references. This exact definition is the state immediately preceding 452.
DELIMITER $$
DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$
CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
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
END$$
DELIMITER ;

-- Restore migration 087's locale-only contract guards before dropping the
-- environment snapshot referenced by migration 452's replacements.
DELIMITER $$
DROP TRIGGER IF EXISTS trg_contracts_mx_template_bi$$
CREATE TRIGGER trg_contracts_mx_template_bi
BEFORE INSERT ON contracts
FOR EACH ROW
BEGIN
  DECLARE v_locale VARCHAR(10);
  IF NEW.contract_template_mx_id IS NOT NULL THEN
    SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'contracts.contract_template_mx_id requires the referenced client to have locale = ''MX''';
    END IF;
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_contracts_mx_template_bu$$
CREATE TRIGGER trg_contracts_mx_template_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
  DECLARE v_locale VARCHAR(10);
  IF NEW.contract_template_mx_id IS NOT NULL THEN
    SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'contracts.contract_template_mx_id requires the referenced client to have locale = ''MX''';
    END IF;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment;
DELIMITER //
CREATE PROCEDURE rollback_452_mx_contract_environment()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_mx_source_environment'
  ) THEN
    ALTER TABLE signed_documents
      DROP FOREIGN KEY fk_signed_documents_mx_source_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'fk_contracts_mx_source_environment'
  ) THEN
    ALTER TABLE contracts
      DROP FOREIGN KEY fk_contracts_mx_source_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_mx_environment_link'
  ) THEN
    ALTER TABLE signed_documents
      DROP CONSTRAINT chk_signed_documents_mx_environment_link;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_evidence_format_version'
  ) THEN
    ALTER TABLE signed_documents
      DROP CONSTRAINT chk_signed_documents_evidence_format_version;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'chk_contracts_mx_environment_link'
  ) THEN
    ALTER TABLE contracts
      DROP CONSTRAINT chk_contracts_mx_environment_link;
  END IF;

  -- Restore migration 078's exact source-FK actions after removing the CHECK
  -- that MariaDB will not permit alongside ON DELETE SET NULL.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND CONSTRAINT_NAME = 'fk_contracts_contract_template_mx'
  ) THEN
    ALTER TABLE contracts DROP FOREIGN KEY fk_contracts_contract_template_mx;
  END IF;
  ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_contract_template_mx
      FOREIGN KEY (contract_template_mx_id)
      REFERENCES contract_templates_mx (id)
      ON DELETE SET NULL ON UPDATE CASCADE;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND CONSTRAINT_NAME = 'chk_contract_templates_mx_environment_status'
  ) THEN
    ALTER TABLE contract_templates_mx
      DROP CONSTRAINT chk_contract_templates_mx_environment_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_mx_source_environment'
  ) THEN
    ALTER TABLE signed_documents
      DROP INDEX idx_signed_documents_mx_source_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND INDEX_NAME = 'idx_contracts_mx_source_environment'
  ) THEN
    ALTER TABLE contracts
      DROP INDEX idx_contracts_mx_source_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND INDEX_NAME = 'idx_contract_templates_mx_org_environment_status'
  ) THEN
    ALTER TABLE contract_templates_mx
      DROP INDEX idx_contract_templates_mx_org_environment_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND INDEX_NAME = 'uq_contract_templates_mx_id_environment'
  ) THEN
    ALTER TABLE contract_templates_mx
      DROP INDEX uq_contract_templates_mx_id_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'organization_mx_profiles'
       AND INDEX_NAME = 'idx_organization_mx_profiles_contract_environment'
  ) THEN
    ALTER TABLE organization_mx_profiles
      DROP INDEX idx_organization_mx_profiles_contract_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_contract_environment'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN mx_contract_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'evidence_format_version'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN evidence_format_version;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contracts'
       AND COLUMN_NAME = 'mx_contract_environment'
  ) THEN
    ALTER TABLE contracts DROP COLUMN mx_contract_environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'status'
       AND COLUMN_TYPE LIKE '%sandbox_ready%'
  ) THEN
    UPDATE contract_templates_mx
       SET status = 'draft'
     WHERE status = 'sandbox_ready';

    ALTER TABLE contract_templates_mx
      MODIFY COLUMN status
        ENUM('draft','submitted','registered','expired','revoked')
        NOT NULL DEFAULT 'draft'
        COMMENT 'draft=being prepared; submitted=sent to IFT/CRT; registered=officially approved; expired=superseded; revoked=withdrawn';
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contract_templates_mx'
       AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE contract_templates_mx DROP COLUMN environment;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'organization_mx_profiles'
       AND COLUMN_NAME = 'contract_environment'
  ) THEN
    ALTER TABLE organization_mx_profiles DROP COLUMN contract_environment;
  END IF;
END //
DELIMITER ;

CALL rollback_452_mx_contract_environment();
DROP PROCEDURE IF EXISTS rollback_452_mx_contract_environment;
