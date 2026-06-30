-- =============================================================================
-- Migration 371 — Add access_mode to nas
-- =============================================================================
-- Adds a per-NAS access_mode column that controls how FireISP connects to the
-- device:
--
--   direct (default) — the admin enters the device's real IP address; FireISP
--     connects directly via ip_address. Existing behavior unchanged.
--
--   nated — the device is behind NAT; FireISP has no routable path to it.
--     FireISP reachess the device exclusively over its WireGuard tunnel address.
--     ip_address is set to the allocated WG tunnel_address on create, so RADIUS
--     client matching, health checks, and the RouterOS API all go over the tunnel
--     uniformly (single ip_address field; no separate "tunnel host" column).
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_371_add_access_mode_to_nas;
DELIMITER //
CREATE PROCEDURE migration_371_add_access_mode_to_nas()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'access_mode'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN access_mode ENUM('direct','nated') NOT NULL DEFAULT 'direct'
          COMMENT 'How FireISP connects to this NAS: direct (ip_address is a routable device IP) or nated (ip_address is the WG tunnel address; device is behind NAT) (migration 371)'
          AFTER api_use_tls;
  END IF;
END //
DELIMITER ;
CALL migration_371_add_access_mode_to_nas();
DROP PROCEDURE IF EXISTS migration_371_add_access_mode_to_nas;
