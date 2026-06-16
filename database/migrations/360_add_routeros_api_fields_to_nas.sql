-- =============================================================================
-- Migration 360 — Add RouterOS API connection fields to nas
-- =============================================================================
-- Lets FireISP push provisioning (e.g. PPPoE secrets) DIRECTLY to a MikroTik
-- RouterOS device over its API, without a FireRelay/proxy agent. Each NAS stores
-- its API port (configurable — operators may run the API on a non-default port),
-- API login user, an AES-GCM encrypted API password, and a TLS (api-ssl) flag.
-- Uses the INFORMATION_SCHEMA stored-proc guard (idempotent on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_360_add_routeros_api_fields_to_nas;
DELIMITER //
CREATE PROCEDURE migration_360_add_routeros_api_fields_to_nas()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'api_port'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN api_port SMALLINT UNSIGNED NULL DEFAULT 8728
          COMMENT 'RouterOS API port for direct provisioning (configurable; 8728 plain / 8729 api-ssl)'
          AFTER last_health_check_at,
      ADD COLUMN api_username VARCHAR(128) NULL
          COMMENT 'RouterOS API login user for direct provisioning'
          AFTER api_port,
      ADD COLUMN api_password_encrypted TEXT NULL
          COMMENT 'AES-256-GCM encrypted RouterOS API password (utils/encryption)'
          AFTER api_username,
      ADD COLUMN api_use_tls BOOLEAN NOT NULL DEFAULT FALSE
          COMMENT 'Use api-ssl (TLS) for the RouterOS API connection'
          AFTER api_password_encrypted;
  END IF;
END //
DELIMITER ;
CALL migration_360_add_routeros_api_fields_to_nas();
DROP PROCEDURE IF EXISTS migration_360_add_routeros_api_fields_to_nas;
