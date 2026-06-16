-- =============================================================================
-- Migration 361 — Make nas.ip_address uniqueness ignore soft-deleted rows
-- =============================================================================
-- The single-column UNIQUE key uq_nas_ip_address (ip_address) does not account
-- for soft deletes (deleted_at), so once a NAS is soft-deleted its IP address is
-- permanently reserved: creating a new NAS with the same IP fails with a
-- duplicate-key error unless the old row is restored or hard-deleted.
--
-- Fix: add a STORED generated column ip_address_active that equals ip_address for
-- live rows and is NULL for soft-deleted rows, and move the UNIQUE constraint
-- onto it. MySQL treats NULLs as distinct in a UNIQUE index, so any number of
-- soft-deleted rows may share an IP while at most one LIVE row may hold it.
--
-- Idempotent via INFORMATION_SCHEMA guards (safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_361_nas_ip_unique_ignore_soft_deleted;
DELIMITER //
CREATE PROCEDURE migration_361_nas_ip_unique_ignore_soft_deleted()
BEGIN
  -- 1. Add the generated column: live IP, or NULL when soft-deleted.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'ip_address_active'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN ip_address_active VARCHAR(45)
        GENERATED ALWAYS AS (IF(deleted_at IS NULL, ip_address, NULL)) STORED
        COMMENT 'ip_address for live rows, NULL when soft-deleted; backs the soft-delete-aware unique key'
        AFTER deleted_at;
  END IF;

  -- 2. Add the soft-delete-aware UNIQUE key BEFORE dropping the old one so the
  --    uniqueness guarantee is never absent.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'uq_nas_ip_address_active'
  ) THEN
    ALTER TABLE nas ADD UNIQUE KEY uq_nas_ip_address_active (ip_address_active);
  END IF;

  -- 3. Drop the old single-column UNIQUE key that ignored soft deletes.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'uq_nas_ip_address'
  ) THEN
    ALTER TABLE nas DROP INDEX uq_nas_ip_address;
  END IF;
END //
DELIMITER ;
CALL migration_361_nas_ip_unique_ignore_soft_deleted();
DROP PROCEDURE IF EXISTS migration_361_nas_ip_unique_ignore_soft_deleted;
