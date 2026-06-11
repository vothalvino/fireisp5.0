-- =============================================================================
-- Migration 238: Create radpostauth table (PPPoE Phase B)
-- =============================================================================
-- Creates the FreeRADIUS radpostauth table for post-authentication logging.
-- FreeRADIUS writes to this table directly via the rlm_sql module;
-- FireISP reads it for auth-failure diagnostics.
--
-- NOTE: No foreign keys — FreeRADIUS writes this table without knowledge of
--       FireISP's organization or subscriber structure.
-- =============================================================================

CREATE TABLE IF NOT EXISTS radpostauth (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL DEFAULT '',
  pass VARCHAR(64) NOT NULL DEFAULT '',
  reply VARCHAR(32) NOT NULL DEFAULT '',
  authdate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  nas_ip_address VARCHAR(45) NULL,
  calling_station_id VARCHAR(100) NULL,
  PRIMARY KEY (id),
  KEY idx_radpostauth_username (username),
  KEY idx_radpostauth_authdate (authdate),
  KEY idx_radpostauth_reply (reply)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
