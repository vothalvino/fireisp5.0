-- =============================================================================
-- Migration 250: SNMPv3 columns on devices + discovery tables
-- =============================================================================
-- Implements isp-platform-features.md §6.1 "SNMP Discovery":
--   Part 1: Adds SNMPv3 credential columns and polling state columns to the
--           devices table via INFORMATION_SCHEMA-guarded stored procedures
--           (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
--   Part 2: Creates discovery_scans — tracks initiated network discovery runs.
--   Part 3: Creates discovery_results — stores per-host results from scans.
--
-- Requires:
--   029_create_snmp_profiles_table
--   devices table (migration 004 or earlier)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Add SNMPv3 columns to devices
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_250_alter_devices;
DELIMITER $$
CREATE PROCEDURE migration_250_alter_devices()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_security_name'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_security_name VARCHAR(255) NULL
        COMMENT 'SNMPv3 security name (USM user)'
        AFTER snmp_profile_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_auth_protocol'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_auth_protocol ENUM('none','md5','sha','sha256','sha512') NULL DEFAULT 'sha'
        COMMENT 'SNMPv3 authentication protocol'
        AFTER snmp_v3_security_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_auth_key_encrypted'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_auth_key_encrypted VARCHAR(512) NULL
        COMMENT 'SNMPv3 auth passphrase — encrypted at app layer'
        AFTER snmp_v3_auth_protocol;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_priv_protocol'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_priv_protocol ENUM('none','des','aes128','aes256') NULL DEFAULT 'aes128'
        COMMENT 'SNMPv3 privacy protocol'
        AFTER snmp_v3_auth_key_encrypted;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_priv_key_encrypted'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_priv_key_encrypted VARCHAR(512) NULL
        COMMENT 'SNMPv3 privacy passphrase — encrypted at app layer'
        AFTER snmp_v3_priv_protocol;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_context_name'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN snmp_v3_context_name VARCHAR(255) NULL
        COMMENT 'SNMPv3 context name (optional)'
        AFTER snmp_v3_priv_key_encrypted;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'last_polled_at'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN last_polled_at DATETIME NULL
        COMMENT 'Timestamp of last successful SNMP poll'
        AFTER snmp_v3_context_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'last_poll_error'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN last_poll_error TEXT NULL
        COMMENT 'Last SNMP poll error message if any'
        AFTER last_polled_at;
  END IF;
END$$
DELIMITER ;
CALL migration_250_alter_devices();
DROP PROCEDURE IF EXISTS migration_250_alter_devices;

-- ---------------------------------------------------------------------------
-- Part 2: discovery_scans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_scans (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    name                    VARCHAR(200)    NOT NULL,
    cidr_ranges             JSON            NOT NULL COMMENT 'Array of CIDR strings to scan e.g. ["192.168.1.0/24","10.0.0.0/8"]',
    snmp_version            ENUM('v1','v2c','v3') NOT NULL DEFAULT 'v2c',
    snmp_community          VARCHAR(255)    NULL     COMMENT 'Community string for v1/v2c scans',
    snmp_v3_security_name   VARCHAR(255)    NULL,
    snmp_v3_auth_protocol   ENUM('none','md5','sha','sha256','sha512') NULL DEFAULT 'sha',
    snmp_v3_auth_key_encrypted VARCHAR(512) NULL     COMMENT 'Encrypted SNMPv3 auth key',
    snmp_v3_priv_protocol   ENUM('none','des','aes128','aes256') NULL DEFAULT 'aes128',
    snmp_v3_priv_key_encrypted VARCHAR(512) NULL     COMMENT 'Encrypted SNMPv3 priv key',
    snmp_port               SMALLINT UNSIGNED NOT NULL DEFAULT 161,
    timeout_ms              INT UNSIGNED    NOT NULL DEFAULT 3000 COMMENT 'SNMP timeout per host in ms',
    concurrency             INT UNSIGNED    NOT NULL DEFAULT 50   COMMENT 'Parallel scan threads',
    status                  ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    scan_started_at         DATETIME        NULL,
    scan_completed_at       DATETIME        NULL,
    total_hosts             INT UNSIGNED    NULL     COMMENT 'Total host count in CIDR ranges',
    scanned_hosts           INT UNSIGNED    NOT NULL DEFAULT 0,
    discovered_hosts        INT UNSIGNED    NOT NULL DEFAULT 0,
    error_message           TEXT            NULL,
    created_by              BIGINT UNSIGNED NULL     COMMENT 'User who initiated scan',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_discovery_scans_org (organization_id),
    KEY idx_discovery_scans_status (status),
    KEY idx_discovery_scans_deleted_at (deleted_at),
    CONSTRAINT fk_discovery_scans_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_discovery_scans_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Part 3: discovery_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_results (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scan_id              BIGINT UNSIGNED NOT NULL,
    organization_id      BIGINT UNSIGNED NULL,
    ip_address           VARCHAR(45)     NOT NULL,
    hostname             VARCHAR(255)    NULL COMMENT 'sysName from sysDescr OID',
    sys_descr            TEXT            NULL COMMENT 'Full sysDescr string',
    sys_oid              VARCHAR(255)    NULL COMMENT 'sysObjectID for vendor detection',
    snmp_version         TINYINT UNSIGNED NOT NULL DEFAULT 2,
    manufacturer         VARCHAR(100)    NULL COMMENT 'Detected from sysObjectID or sysDescr',
    model                VARCHAR(100)    NULL,
    device_type          ENUM('outdoor_cpe','indoor_cpe','ptp','ptmp_ap','olt','router','switch','onu','other') NULL,
    suggested_profile_id BIGINT UNSIGNED NULL COMMENT 'Auto-matched SNMP profile',
    status               ENUM('pending_review','onboarded','ignored') NOT NULL DEFAULT 'pending_review',
    device_id            BIGINT UNSIGNED NULL COMMENT 'Created device after onboarding',
    discovered_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_discovery_results_scan_id (scan_id),
    KEY idx_discovery_results_org (organization_id),
    KEY idx_discovery_results_status (status),
    KEY idx_discovery_results_ip (ip_address),
    CONSTRAINT fk_dr_scan FOREIGN KEY (scan_id)
        REFERENCES discovery_scans (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dr_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dr_profile FOREIGN KEY (suggested_profile_id)
        REFERENCES snmp_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dr_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
