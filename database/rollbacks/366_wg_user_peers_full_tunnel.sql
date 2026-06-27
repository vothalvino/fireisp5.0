-- =============================================================================
-- Rollback 366 — Remove full_tunnel column from wg_user_peers
-- =============================================================================
-- Reverses migration 366. Drops the full_tunnel column added to wg_user_peers.
-- WARNING: All full-tunnel configuration for existing peers is lost.
--
-- MySQL 8 does not support DROP COLUMN IF EXISTS, so the drop is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_366_wg_user_peers_full_tunnel;
DELIMITER //
CREATE PROCEDURE rollback_366_wg_user_peers_full_tunnel()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'wg_user_peers'
      AND COLUMN_NAME  = 'full_tunnel'
  ) THEN
    ALTER TABLE wg_user_peers DROP COLUMN full_tunnel;
  END IF;
END //
DELIMITER ;
CALL rollback_366_wg_user_peers_full_tunnel();
DROP PROCEDURE IF EXISTS rollback_366_wg_user_peers_full_tunnel;
