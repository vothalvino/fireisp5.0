-- =============================================================================
-- FireISP 5.0 — Rollback 186: Restore plans / quotes / credit_notes to the
--                             pre-contract-alignment schema
-- =============================================================================
-- Reverses migration 186.  Mirrors the forward migration's guards: each rename
-- is applied only when the new name currently exists and the old name does
-- not, so a partially applied migration still rolls back cleanly.
--
-- IRREVERSIBILITY NOTES (data, not structure):
--   * plans.status — rows set to 'archived' after migration 186 are remapped
--     to 'inactive' before the ENUM is narrowed; the 'archived' state is lost.
--   * credit_notes.reason — the forward migration remapped
--     return/downgrade -> 'other'; that mapping is many-to-one and cannot be
--     undone, so such rows stay 'other'.  Values that have a 1:1 inverse are
--     remapped back (promotional_credit -> courtesy, service_interruption ->
--     service_outage, overpayment -> duplicate_payment,
--     contract_cancellation -> cancellation).
--   * quotes.organization_id / quotes.contract_id / credit_notes.organization_id
--     were added (and back-filled) by migration 186, so they are dropped here
--     together with their FKs and indexes.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_186_align_billing_sales;
DELIMITER //
CREATE PROCEDURE rollback_186_align_billing_sales()
BEGIN
  -- ===========================================================================
  -- credit_notes
  -- ===========================================================================

  -- organization_id: FK -> index -> column
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'
      AND CONSTRAINT_NAME = 'fk_credit_notes_organization'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE credit_notes DROP FOREIGN KEY fk_credit_notes_organization;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'
      AND INDEX_NAME = 'idx_credit_notes_organization_id'
  ) THEN
    ALTER TABLE credit_notes DROP INDEX idx_credit_notes_organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE credit_notes DROP COLUMN organization_id;
  END IF;

  -- issue_date: remove the DEFAULT (CURRENT_DATE) added by the migration
  ALTER TABLE credit_notes
    MODIFY COLUMN issue_date DATE NOT NULL;

  -- reason: remap the contract ENUM values back to the original ones, then
  -- narrow the column to the original ENUM definition (widen first so the
  -- UPDATEs can write legacy values).
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'
      AND COLUMN_NAME = 'reason'
      AND COLUMN_TYPE LIKE '%service_interruption%'
  ) THEN
    ALTER TABLE credit_notes
      MODIFY COLUMN reason VARCHAR(50) NOT NULL;

    UPDATE credit_notes SET reason = 'courtesy'          WHERE reason = 'promotional_credit';
    UPDATE credit_notes SET reason = 'service_outage'    WHERE reason = 'service_interruption';
    UPDATE credit_notes SET reason = 'duplicate_payment' WHERE reason = 'overpayment';
    UPDATE credit_notes SET reason = 'cancellation'      WHERE reason = 'contract_cancellation';

    ALTER TABLE credit_notes
      MODIFY COLUMN reason ENUM(
          'return',
          'courtesy',
          'service_outage',
          'billing_error',
          'duplicate_payment',
          'downgrade',
          'cancellation',
          'other'
      ) NOT NULL
        COMMENT 'return=client returned equipment; courtesy=goodwill/customer satisfaction; service_outage=compensation for downtime; billing_error=incorrect charge on invoice; duplicate_payment=client paid twice; downgrade=refund of unused service after plan change; cancellation=prorated refund for early termination; other=see notes';
  END IF;

  -- ===========================================================================
  -- quotes
  -- ===========================================================================

  -- contract_id: FK -> index -> column
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND CONSTRAINT_NAME = 'fk_quotes_contract'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE quotes DROP FOREIGN KEY fk_quotes_contract;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND INDEX_NAME = 'idx_quotes_contract_id'
  ) THEN
    ALTER TABLE quotes DROP INDEX idx_quotes_contract_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND COLUMN_NAME = 'contract_id'
  ) THEN
    ALTER TABLE quotes DROP COLUMN contract_id;
  END IF;

  -- organization_id: FK -> index -> column
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND CONSTRAINT_NAME = 'fk_quotes_organization'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE quotes DROP FOREIGN KEY fk_quotes_organization;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND INDEX_NAME = 'idx_quotes_organization_id'
  ) THEN
    ALTER TABLE quotes DROP INDEX idx_quotes_organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE quotes DROP COLUMN organization_id;
  END IF;

  -- issue_date: remove the DEFAULT (CURRENT_DATE) added by the migration
  ALTER TABLE quotes
    MODIFY COLUMN issue_date DATE NOT NULL;

  -- valid_until -> expiry_date
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND COLUMN_NAME = 'valid_until'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
      AND COLUMN_NAME = 'expiry_date'
  ) THEN
    ALTER TABLE quotes
      CHANGE COLUMN valid_until expiry_date DATE NULL;
  END IF;

  -- ===========================================================================
  -- plans
  -- ===========================================================================

  -- status: remap 'archived' rows, then narrow the ENUM back
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'status'
      AND COLUMN_TYPE LIKE '%archived%'
  ) THEN
    UPDATE plans SET status = 'inactive' WHERE status = 'archived';

    ALTER TABLE plans
      MODIFY COLUMN status ENUM('active', 'inactive') NOT NULL DEFAULT 'active';
  END IF;

  -- priority -> contention
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'priority'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'contention'
  ) THEN
    ALTER TABLE plans
      CHANGE COLUMN priority contention TINYINT UNSIGNED NULL
        COMMENT 'Contention ratio e.g. 10 means 10:1';
  END IF;

  -- burst_upload_mbps -> burst_upload
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'burst_upload_mbps'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'burst_upload'
  ) THEN
    ALTER TABLE plans
      CHANGE COLUMN burst_upload_mbps burst_upload INT UNSIGNED NULL
        COMMENT 'Burst upload speed in Mbps';
  END IF;

  -- burst_download_mbps -> burst_download
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'burst_download_mbps'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'burst_download'
  ) THEN
    ALTER TABLE plans
      CHANGE COLUMN burst_download_mbps burst_download INT UNSIGNED NULL
        COMMENT 'Burst download speed in Mbps';
  END IF;

  -- upload_speed_mbps -> upload_speed
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'upload_speed_mbps'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'upload_speed'
  ) THEN
    ALTER TABLE plans
      CHANGE COLUMN upload_speed_mbps upload_speed INT UNSIGNED NOT NULL
        COMMENT 'Speed in Mbps';
  END IF;

  -- download_speed_mbps -> download_speed
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'download_speed_mbps'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'download_speed'
  ) THEN
    ALTER TABLE plans
      CHANGE COLUMN download_speed_mbps download_speed INT UNSIGNED NOT NULL
        COMMENT 'Speed in Mbps';
  END IF;
END //
DELIMITER ;
CALL rollback_186_align_billing_sales();
DROP PROCEDURE IF EXISTS rollback_186_align_billing_sales;
