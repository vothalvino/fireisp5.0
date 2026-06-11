-- Migration: 177_add_organization_id_to_payments_and_tickets
-- Description: Adds organization_id to payments and tickets tables.
--
-- The payments route sets req.body.organization_id = req.orgId before calling
-- Payment.create(), and Payment.fillable includes 'organization_id', so
-- BaseModel.create() tries to INSERT that column — failing with "Unknown column"
-- because the column was never added to the table.
--
-- The tickets route does the same: req.body.organization_id = req.orgId and
-- Ticket.fillable includes 'organization_id'.  Same root cause.
--
-- Both tables also need the column for multi-tenant org-scoped queries that
-- use WHERE organization_id = ? in the application routes.
--
-- All schema changes are guarded with INFORMATION_SCHEMA checks so the
-- migration is safely re-runnable after a partial failure; the back-fill
-- UPDATEs are naturally idempotent and stay bare.

-- ── payments ─────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS migration_177_add_payments_org_column;
DELIMITER //
CREATE PROCEDURE migration_177_add_payments_org_column()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE payments
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
        AFTER id;
  END IF;
END //
DELIMITER ;
CALL migration_177_add_payments_org_column();
DROP PROCEDURE IF EXISTS migration_177_add_payments_org_column;

-- Back-fill organization_id from the owning client
UPDATE payments p
  JOIN clients c ON c.id = p.client_id
SET p.organization_id = c.organization_id
WHERE p.organization_id IS NULL;

DROP PROCEDURE IF EXISTS migration_177_add_payments_org_keys;
DELIMITER //
CREATE PROCEDURE migration_177_add_payments_org_keys()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND INDEX_NAME   = 'idx_payments_organization_id'
  ) THEN
    ALTER TABLE payments
      ADD KEY idx_payments_organization_id (organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'payments'
      AND CONSTRAINT_NAME       = 'fk_payments_organization'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_payments_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_177_add_payments_org_keys();
DROP PROCEDURE IF EXISTS migration_177_add_payments_org_keys;

-- ── tickets ──────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS migration_177_add_tickets_org_column;
DELIMITER //
CREATE PROCEDURE migration_177_add_tickets_org_column()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tickets'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE tickets
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
        AFTER id;
  END IF;
END //
DELIMITER ;
CALL migration_177_add_tickets_org_column();
DROP PROCEDURE IF EXISTS migration_177_add_tickets_org_column;

-- Back-fill organization_id from the owning client
UPDATE tickets t
  JOIN clients c ON c.id = t.client_id
SET t.organization_id = c.organization_id
WHERE t.organization_id IS NULL;

DROP PROCEDURE IF EXISTS migration_177_add_tickets_org_keys;
DELIMITER //
CREATE PROCEDURE migration_177_add_tickets_org_keys()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tickets'
      AND INDEX_NAME   = 'idx_tickets_organization_id'
  ) THEN
    ALTER TABLE tickets
      ADD KEY idx_tickets_organization_id (organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'tickets'
      AND CONSTRAINT_NAME       = 'fk_tickets_organization'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT fk_tickets_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_177_add_tickets_org_keys();
DROP PROCEDURE IF EXISTS migration_177_add_tickets_org_keys;
