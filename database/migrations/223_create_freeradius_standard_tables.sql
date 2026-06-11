-- =============================================================================
-- Migration 223: FreeRADIUS standard tables, radius auth_method column,
--                subscriber_certificates table
-- =============================================================================
-- Implements isp-platform-features.md §3.1 "RADIUS AAA Phase A":
--   • radcheck          — per-user check attributes (e.g. Cleartext-Password)
--   • radreply          — per-user reply attributes (e.g. Framed-IP-Address)
--   • radusergroup      — maps users to RADIUS groups
--   • radgroupcheck     — per-group check attributes
--   • radgroupreply     — per-group reply attributes
--   • radius.auth_method — tracks authentication method per subscriber account
--   • subscriber_certificates — stores EAP-TLS client certificates
--
-- Seeds the check_certificate_expiry scheduled task (0 6 * * *).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: radcheck — per-user check attributes (standard FreeRADIUS schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radcheck (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '==',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radcheck_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radreply — per-user reply attributes (standard FreeRADIUS schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radreply (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '=',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radreply_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radusergroup — maps RADIUS usernames to groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radusergroup (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    priority  INT             NOT NULL DEFAULT 1,

    PRIMARY KEY (id),
    KEY idx_radusergroup_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radgroupcheck — per-group check attributes (standard FreeRADIUS schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radgroupcheck (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '==',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radgroupcheck_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radgroupreply — per-group reply attributes (standard FreeRADIUS schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radgroupreply (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '=',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radgroupreply_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Alter radius: add auth_method column.
-- MySQL does not support ADD COLUMN IF NOT EXISTS — use an idempotent
-- stored-procedure guard (same pattern as migration 198).
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_223_add_radius_auth_method;
DELIMITER //
CREATE PROCEDURE migration_223_add_radius_auth_method()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'auth_method'
  ) THEN
    ALTER TABLE radius
      ADD COLUMN auth_method ENUM('pppoe','mac','dot1x','eap_tls')
          NOT NULL DEFAULT 'pppoe'
          COMMENT 'Authentication method used by this subscriber account'
          AFTER profile;
  END IF;
END //
DELIMITER ;
CALL migration_223_add_radius_auth_method();
DROP PROCEDURE IF EXISTS migration_223_add_radius_auth_method;

-- ---------------------------------------------------------------------------
-- Table: subscriber_certificates — EAP-TLS client certificates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_certificates (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant organization; NULL = single-tenant deployment',
    radius_account_id   BIGINT UNSIGNED NULL
                            COMMENT 'Linked RADIUS account (radius.id)',
    client_id           BIGINT UNSIGNED NULL
                            COMMENT 'Linked subscriber (clients.id)',
    common_name         VARCHAR(255)    NOT NULL
                            COMMENT 'Certificate CN, typically the RADIUS username',
    serial_number       VARCHAR(100)    NOT NULL
                            COMMENT 'Certificate serial number (hex string)',
    fingerprint_sha256  VARCHAR(64)     NOT NULL
                            COMMENT 'SHA-256 fingerprint of the certificate (hex, no colons)',
    valid_from          DATETIME        NOT NULL,
    valid_until         DATETIME        NOT NULL,
    status              ENUM('active','revoked','expired')
                            NOT NULL DEFAULT 'active',
    revoked_at          DATETIME        NULL,
    revocation_reason   VARCHAR(255)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_subscriber_certificates_org_id (organization_id),
    KEY idx_subscriber_certificates_radius_account_id (radius_account_id),
    KEY idx_subscriber_certificates_client_id (client_id),
    KEY idx_subscriber_certificates_status (status),
    KEY idx_subscriber_certificates_valid_until (valid_until),
    CONSTRAINT fk_subscriber_certificates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_subscriber_certificates_radius_account FOREIGN KEY (radius_account_id)
        REFERENCES radius (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriber_certificates_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: scheduled task for certificate expiry monitoring
--
-- Idempotency note: INSERT ... SELECT ... WHERE NOT EXISTS — the UNIQUE KEY
-- on (organization_id, task_name) never collides when organization_id is
-- NULL, so INSERT IGNORE would duplicate the row on re-run.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'check_certificate_expiry',
    'Check subscriber EAP-TLS certificates expiring within 30 days and log warnings',
    '0 6 * * *',
    TRUE,
    'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'check_certificate_expiry' AND organization_id IS NULL
);
