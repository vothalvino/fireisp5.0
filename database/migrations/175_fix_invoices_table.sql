-- Migration: 175_fix_invoices_table
-- Description: Aligns the invoices table with the application code:
--
--   1. organization_id (BIGINT UNSIGNED NULL):
--      billingService.generateInvoice() inserts this column from the caller's
--      orgId; the Invoice model lists it in FILLABLE; invoice routes scope
--      reads with WHERE organization_id = ?; the DSAR route exports it.
--      Without this column every invoice INSERT fails with "Unknown column".
--
--   2. issued_at (DATETIME NULL DEFAULT CURRENT_TIMESTAMP):
--      The DSAR export query selects issued_at.  issue_date (DATE) is the
--      accounting date; issued_at is the exact timestamp the invoice record
--      was created.  Adding it with a server-side default means no INSERT
--      changes are required.
--
--   3. issue_date DEFAULT (CURRENT_DATE):
--      billingService INSERT does not include issue_date.  Without a DEFAULT
--      MySQL rejects the INSERT in STRICT_TRANS_TABLES mode (the default in
--      MySQL 8+).  Expression defaults are supported in MySQL 8.0.13+.
--
--   4. status ENUM expanded to ('draft','issued','sent','paid','overdue',
--      'cancelled','void'):
--      billingService inserts 'issued'; the validation schema allows 'issued'
--      and 'void'; the original ENUM only had draft/sent/paid/overdue/cancelled.
--
--   Column/key/FK additions are guarded with INFORMATION_SCHEMA checks so the
--   migration is safely re-runnable after a partial failure; the MODIFY
--   COLUMN statements are naturally re-runnable and stay bare.

DROP PROCEDURE IF EXISTS migration_175_add_invoices_columns;
DELIMITER //
CREATE PROCEDURE migration_175_add_invoices_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
        AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND COLUMN_NAME  = 'issued_at'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN issued_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
        COMMENT 'Timestamp when the invoice record was created (used by DSAR export)'
        AFTER due_date;
  END IF;
END //
DELIMITER ;
CALL migration_175_add_invoices_columns();
DROP PROCEDURE IF EXISTS migration_175_add_invoices_columns;

ALTER TABLE invoices
  MODIFY COLUMN issue_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    COMMENT 'Billing date of the invoice',
  MODIFY COLUMN status
    ENUM('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled', 'void')
    NOT NULL DEFAULT 'draft';

-- Back-fill organization_id from each invoice's owning client
UPDATE invoices i
  JOIN clients c ON c.id = i.client_id
SET i.organization_id = c.organization_id
WHERE i.organization_id IS NULL;

-- Index and FK for organization_id
DROP PROCEDURE IF EXISTS migration_175_add_invoices_org_keys;
DELIMITER //
CREATE PROCEDURE migration_175_add_invoices_org_keys()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'idx_invoices_organization_id'
  ) THEN
    ALTER TABLE invoices
      ADD KEY idx_invoices_organization_id (organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'idx_invoices_org_status'
  ) THEN
    ALTER TABLE invoices
      ADD KEY idx_invoices_org_status (organization_id, status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'invoices'
      AND CONSTRAINT_NAME       = 'fk_invoices_organization'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_175_add_invoices_org_keys();
DROP PROCEDURE IF EXISTS migration_175_add_invoices_org_keys;
