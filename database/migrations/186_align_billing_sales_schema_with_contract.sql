-- Migration: 186_align_billing_sales_schema_with_contract
-- Description: Aligns the plans, quotes, and credit_notes tables with the
--   authoritative application contract (Sequelize-free models in
--   src/models/*, validation schemas in src/middleware/schemas/*, the
--   generated docs/openapi.json, and the frontend billing pages). The
--   original tables drifted from the column names / ENUM values the code
--   actually reads and writes, so real-DB create/edit against these tables
--   failed with "Unknown column" / truncated-ENUM errors even though the
--   unit tests (which mock db.query) passed.
--
--   plans:
--     * download_speed   -> download_speed_mbps
--     * upload_speed     -> upload_speed_mbps
--     * burst_download   -> burst_download_mbps
--     * burst_upload     -> burst_upload_mbps
--     * contention       -> priority (model/validation use `priority`, 1-8)
--     * status ENUM gains 'archived' (validation allows it)
--
--   quotes:
--     * expiry_date      -> valid_until (model FILLABLE + frontend field)
--     * issue_date gains DEFAULT (CURRENT_DATE) — create path never supplies it
--     * organization_id added — Quote.hasOrgScope=true and the routes scope
--       reads/writes with WHERE organization_id = ? (incl. convert-to-invoice)
--     * contract_id added — Quote FILLABLE lists it and convert-to-invoice
--       reads quote.contract_id when creating the invoice
--
--   credit_notes:
--     * reason ENUM remapped to the contract values
--       (billing_error, service_interruption, overpayment, promotional_credit,
--        contract_cancellation, other)
--     * issue_date gains DEFAULT (CURRENT_DATE) — create path never supplies it
--     * organization_id added — CreditNote.hasOrgScope=true and routes scope
--       reads/writes with WHERE organization_id = ?
--
-- Expression defaults — DEFAULT (CURRENT_DATE) — require MySQL 8.0.13+.

SET @db_name = DATABASE();

-- ===========================================================================
-- plans
-- ===========================================================================

-- Rename the speed columns to the *_mbps names the code uses. Each rename is
-- guarded on the old column still existing so the migration is idempotent.
SET @has_plans_download_speed = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'plans'
    AND COLUMN_NAME = 'download_speed'
);
SET @sql = IF(
  @has_plans_download_speed = 1,
  'ALTER TABLE plans CHANGE COLUMN download_speed download_speed_mbps INT UNSIGNED NOT NULL COMMENT ''Download speed in Mbps''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_plans_upload_speed = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'plans'
    AND COLUMN_NAME = 'upload_speed'
);
SET @sql = IF(
  @has_plans_upload_speed = 1,
  'ALTER TABLE plans CHANGE COLUMN upload_speed upload_speed_mbps INT UNSIGNED NOT NULL COMMENT ''Upload speed in Mbps''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_plans_burst_download = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'plans'
    AND COLUMN_NAME = 'burst_download'
);
SET @sql = IF(
  @has_plans_burst_download = 1,
  'ALTER TABLE plans CHANGE COLUMN burst_download burst_download_mbps INT UNSIGNED NULL COMMENT ''Burst download speed in Mbps''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_plans_burst_upload = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'plans'
    AND COLUMN_NAME = 'burst_upload'
);
SET @sql = IF(
  @has_plans_burst_upload = 1,
  'ALTER TABLE plans CHANGE COLUMN burst_upload burst_upload_mbps INT UNSIGNED NULL COMMENT ''Burst upload speed in Mbps''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- contention ratio -> priority (the model/validation expose `priority`, 1-8).
SET @has_plans_contention = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'plans'
    AND COLUMN_NAME = 'contention'
);
SET @sql = IF(
  @has_plans_contention = 1,
  'ALTER TABLE plans CHANGE COLUMN contention priority TINYINT UNSIGNED NULL COMMENT ''Plan priority 1-8 (1 = highest)''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Expand the status ENUM to allow 'archived' (validation accepts it).
ALTER TABLE plans
  MODIFY COLUMN status ENUM('active', 'inactive', 'archived')
    NOT NULL DEFAULT 'active';

-- ===========================================================================
-- quotes
-- ===========================================================================

-- expiry_date -> valid_until
SET @has_quotes_expiry_date = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND COLUMN_NAME = 'expiry_date'
);
SET @sql = IF(
  @has_quotes_expiry_date = 1,
  'ALTER TABLE quotes CHANGE COLUMN expiry_date valid_until DATE NULL COMMENT ''Date this quote expires''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- issue_date needs a server-side default; the create path never supplies it.
ALTER TABLE quotes
  MODIFY COLUMN issue_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    COMMENT 'Date this quote was issued';

-- organization_id — tenant scope expected by Quote.hasOrgScope and the routes.
SET @has_quotes_org = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_quotes_org = 0,
  'ALTER TABLE quotes ADD COLUMN organization_id BIGINT UNSIGNED NULL COMMENT ''Owning tenant organisation; NULL = single-tenant deployment'' AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- contract_id — Quote FILLABLE + convert-to-invoice reads quote.contract_id.
SET @has_quotes_contract = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND COLUMN_NAME = 'contract_id'
);
SET @sql = IF(
  @has_quotes_contract = 0,
  'ALTER TABLE quotes ADD COLUMN contract_id BIGINT UNSIGNED NULL COMMENT ''Contract this quote relates to, if any'' AFTER client_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Back-fill organization_id from each quote's owning client.
UPDATE quotes q
  JOIN clients c ON c.id = q.client_id
SET q.organization_id = c.organization_id
WHERE q.organization_id IS NULL;

-- Index + FK for organization_id
SET @has_quotes_org_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND INDEX_NAME = 'idx_quotes_organization_id'
);
SET @sql = IF(
  @has_quotes_org_idx = 0,
  'CREATE INDEX idx_quotes_organization_id ON quotes (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_quotes_org_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND CONSTRAINT_NAME = 'fk_quotes_organization'
);
SET @sql = IF(
  @has_quotes_org_fk = 0,
  'ALTER TABLE quotes ADD CONSTRAINT fk_quotes_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index + FK for contract_id
SET @has_quotes_contract_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND INDEX_NAME = 'idx_quotes_contract_id'
);
SET @sql = IF(
  @has_quotes_contract_idx = 0,
  'CREATE INDEX idx_quotes_contract_id ON quotes (contract_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_quotes_contract_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'quotes'
    AND CONSTRAINT_NAME = 'fk_quotes_contract'
);
SET @sql = IF(
  @has_quotes_contract_fk = 0,
  'ALTER TABLE quotes ADD CONSTRAINT fk_quotes_contract FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ===========================================================================
-- credit_notes
-- ===========================================================================

-- Remap the reason ENUM to the contract values. Widen to VARCHAR first so the
-- old values can be translated without violating the target ENUM, then narrow
-- back to the final ENUM. Re-running is safe (the UPDATEs simply match nothing).
ALTER TABLE credit_notes
  MODIFY COLUMN reason VARCHAR(50) NOT NULL;

UPDATE credit_notes SET reason = 'other'                 WHERE reason = 'return';
UPDATE credit_notes SET reason = 'promotional_credit'    WHERE reason = 'courtesy';
UPDATE credit_notes SET reason = 'service_interruption'  WHERE reason = 'service_outage';
UPDATE credit_notes SET reason = 'overpayment'           WHERE reason = 'duplicate_payment';
UPDATE credit_notes SET reason = 'other'                 WHERE reason = 'downgrade';
UPDATE credit_notes SET reason = 'contract_cancellation' WHERE reason = 'cancellation';

ALTER TABLE credit_notes
  MODIFY COLUMN reason
    ENUM('billing_error', 'service_interruption', 'overpayment',
         'promotional_credit', 'contract_cancellation', 'other')
    NOT NULL COMMENT 'Reason the credit note was issued';

-- issue_date needs a server-side default; the create path never supplies it.
ALTER TABLE credit_notes
  MODIFY COLUMN issue_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    COMMENT 'Date this credit note was issued';

-- organization_id — tenant scope expected by CreditNote.hasOrgScope + routes.
SET @has_cn_org = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'credit_notes'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_cn_org = 0,
  'ALTER TABLE credit_notes ADD COLUMN organization_id BIGINT UNSIGNED NULL COMMENT ''Owning tenant organisation; NULL = single-tenant deployment'' AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Back-fill organization_id from each credit note's owning client.
UPDATE credit_notes cn
  JOIN clients c ON c.id = cn.client_id
SET cn.organization_id = c.organization_id
WHERE cn.organization_id IS NULL;

-- Index + FK for organization_id
SET @has_cn_org_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'credit_notes'
    AND INDEX_NAME = 'idx_credit_notes_organization_id'
);
SET @sql = IF(
  @has_cn_org_idx = 0,
  'CREATE INDEX idx_credit_notes_organization_id ON credit_notes (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cn_org_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'credit_notes'
    AND CONSTRAINT_NAME = 'fk_credit_notes_organization'
);
SET @sql = IF(
  @has_cn_org_fk = 0,
  'ALTER TABLE credit_notes ADD CONSTRAINT fk_credit_notes_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
