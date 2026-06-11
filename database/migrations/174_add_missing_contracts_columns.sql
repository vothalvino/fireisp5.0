-- Migration: 174_add_missing_contracts_columns
-- Description: Adds organization_id, billing_day, and ip_address columns to the
--              contracts table.  These fields are referenced by the Contract model
--              FILLABLE list, the suspend/unsuspend routes (WHERE organization_id = ?),
--              and the API validation schema — but were never present in the table,
--              causing MySQL errors on every contract creation or org-scoped lookup.
--
--              Backfill: organization_id is populated from the owning client row so
--              existing contracts are immediately tenant-scoped without manual work.
--
--              All schema changes are guarded with INFORMATION_SCHEMA checks so
--              the migration is safely re-runnable after a partial failure.

DROP PROCEDURE IF EXISTS migration_174_add_contracts_columns;
DELIMITER //
CREATE PROCEDURE migration_174_add_contracts_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
        AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'billing_day'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN billing_day TINYINT UNSIGNED NULL
        COMMENT 'Day of month (1–28) on which invoices are generated; NULL = inherit from plan'
        CHECK (billing_day BETWEEN 1 AND 28)
        AFTER end_date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'ip_address'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN ip_address VARCHAR(45) NULL
        COMMENT 'Static IPv4/IPv6 address assigned to this service; NULL = dynamic'
        AFTER billing_day;
  END IF;
END //
DELIMITER ;
CALL migration_174_add_contracts_columns();
DROP PROCEDURE IF EXISTS migration_174_add_contracts_columns;

-- Back-fill organization_id from the owning client
UPDATE contracts c
  JOIN clients cl ON cl.id = c.client_id
SET c.organization_id = cl.organization_id
WHERE c.organization_id IS NULL;

-- Index and FK for organization_id
DROP PROCEDURE IF EXISTS migration_174_add_contracts_org_keys;
DELIMITER //
CREATE PROCEDURE migration_174_add_contracts_org_keys()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND INDEX_NAME   = 'idx_contracts_organization_id'
  ) THEN
    ALTER TABLE contracts
      ADD KEY idx_contracts_organization_id (organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND INDEX_NAME   = 'idx_contracts_org_status'
  ) THEN
    ALTER TABLE contracts
      ADD KEY idx_contracts_org_status (organization_id, status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'contracts'
      AND CONSTRAINT_NAME       = 'fk_contracts_organization'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT fk_contracts_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_174_add_contracts_org_keys();
DROP PROCEDURE IF EXISTS migration_174_add_contracts_org_keys;
