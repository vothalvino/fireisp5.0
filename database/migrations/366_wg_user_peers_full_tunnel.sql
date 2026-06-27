-- =============================================================================
-- Migration 366 — Add full_tunnel flag to wg_user_peers
-- =============================================================================
-- Adds a per-peer toggle so the issued WireGuard client config can use
-- AllowedIPs=0.0.0.0/0,::/0 (full-tunnel) instead of the scoped CIDR list.
-- DEFAULT 1 for future inserts (new peers are full-tunnel by default).
-- Backfill sets existing rows to 0 so pre-existing peers stay split-tunnel.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_366_wg_user_peers_full_tunnel;
DELIMITER //
CREATE PROCEDURE migration_366_wg_user_peers_full_tunnel()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'wg_user_peers'
      AND COLUMN_NAME  = 'full_tunnel'
  ) THEN
    ALTER TABLE wg_user_peers
      ADD COLUMN full_tunnel TINYINT(1) NOT NULL DEFAULT 1
        COMMENT '1=full-tunnel (AllowedIPs 0.0.0.0/0,::/0); 0=split-tunnel (scoped CIDRs); DEFAULT 1 for new peers'
        AFTER server_peer_synced;
    -- Backfill: all existing peers remain split-tunnel (preserve current behaviour)
    UPDATE wg_user_peers SET full_tunnel = 0;
  END IF;
END //
DELIMITER ;
CALL migration_366_wg_user_peers_full_tunnel();
DROP PROCEDURE IF EXISTS migration_366_wg_user_peers_full_tunnel;
