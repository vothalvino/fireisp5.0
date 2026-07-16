-- =============================================================================
-- Migration 397 — Add consecutive_poll_failures to devices
-- =============================================================================
-- Backs the new device up/down state-machine (src/services/deviceStatusService.js):
-- a device flips devices.status to 'offline' after N consecutive failed polls
-- (currently 3) and back to 'online' on the next successful poll, instead of
-- devices.status never being written by the pollers at all (it previously sat
-- frozen at its default 'offline' forever).
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_397_add_consecutive_poll_failures;
DELIMITER //
CREATE PROCEDURE migration_397_add_consecutive_poll_failures()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'consecutive_poll_failures'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN consecutive_poll_failures INT NOT NULL DEFAULT 0
          COMMENT 'Consecutive failed SNMP polls; >= 3 flips status to offline (migration 397)'
          AFTER last_poll_error;
  END IF;
END //
DELIMITER ;
CALL migration_397_add_consecutive_poll_failures();
DROP PROCEDURE IF EXISTS migration_397_add_consecutive_poll_failures;
