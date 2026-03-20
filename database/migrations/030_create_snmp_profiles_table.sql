-- Migration: 030_create_snmp_profiles_table
-- Description: Creates the snmp_profiles table — named SNMP polling templates
--              matched by manufacturer, model pattern, and device type.
--              Profiles allow per-vendor/model OID customization without changing
--              any core polling logic — just insert new rows into this table.

-- ---------------------------------------------------------------------------
-- Table: snmp_profiles
-- Purpose: Named SNMP polling templates matched by manufacturer/model/device_type.
--          The poller selects a profile per device and walks only the OIDs
--          defined in snmp_profile_oids for that profile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_profiles (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100)    NOT NULL COMMENT 'Profile name e.g. Ubiquiti airOS, MikroTik RouterOS',
    manufacturer  VARCHAR(100)    NULL     COMMENT 'Match devices.manufacturer (NULL = any)',
    model_pattern VARCHAR(100)    NULL     COMMENT 'SQL LIKE pattern to match devices.model (NULL = any)',
    device_type   ENUM('outdoor_cpe','indoor_cpe','ptp','ptmp_ap','olt','router','switch','onu','other') NULL
                                           COMMENT 'Match devices.type (NULL = any)',
    snmp_version  ENUM('v1','v2c','v3') NULL DEFAULT 'v2c' COMMENT 'Preferred SNMP version for this profile',
    poll_interval_sec INT UNSIGNED NOT NULL DEFAULT 300 COMMENT 'Poll interval in seconds (default 5 min)',
    is_default    BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'Fallback profile when no manufacturer/model match',
    description   TEXT            NULL,
    status        ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_profiles_name (name),
    KEY idx_snmp_profiles_manufacturer (manufacturer),
    KEY idx_snmp_profiles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
