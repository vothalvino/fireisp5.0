-- =============================================================================
-- Migration 456 — NAS maintenance mode for PPPoE diagnostics
-- =============================================================================
-- An active NAS can be intentionally offline, a lab placeholder, or undergoing
-- work.  Marking it inactive is too broad: it also changes its operational
-- lifecycle.  This independent flag keeps the NAS active and available for
-- manual connection/provisioning actions while excluding it from automated
-- RouterOS PPPoE log polling and readiness coverage.
--
-- FALSE preserves the behavior of every existing row.  The independent guard
-- makes the migration safe to resume after interrupted MySQL DDL.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_456_nas_maintenance_mode;
DELIMITER //
CREATE PROCEDURE migration_456_nas_maintenance_mode()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'nas'
       AND COLUMN_NAME = 'maintenance_mode'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE
        COMMENT 'Keep NAS active but exclude it from automated PPPoE diagnostics polling/readiness (migration 456)'
        AFTER access_mode;
  END IF;
END //
DELIMITER ;

CALL migration_456_nas_maintenance_mode();
DROP PROCEDURE IF EXISTS migration_456_nas_maintenance_mode;
