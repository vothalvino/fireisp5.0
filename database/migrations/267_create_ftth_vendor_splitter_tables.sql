-- =============================================================================
-- Migration 267: FTTH — OLT vendor capability profiles + splitter management
-- =============================================================================
-- Implements §7.1 vendor support and §7.1 splitter management.
--
-- Tables created:
--   olt_vendor_capabilities — per-vendor supported features / CLI template refs
--   olt_splitters           — splitter inventory (1:N ratio, site, OLT port link)
--
-- olt_chassis_metrics extended via stored-procedure ALTER on snmp_metrics
-- is NOT done here — OLT chassis data (CPU/mem/temp/PSU/fan) is captured via
-- the existing SNMP metrics pipeline using the Huawei OLT / ZTE OLT profiles
-- seeded in migration 264. The columns cpu_usage, memory_usage, temperature_c
-- already exist in snmp_metrics from migrations 255/264.
--
-- onu_details.last_provision_job_id FK is added here after onu_firmware_jobs
-- exists (migration 266 created both tables but the FK was intentionally
-- omitted to avoid a forward-reference; we add it now as a guarded ALTER).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: olt_vendor_capabilities
-- Purpose: Per-vendor capability matrix — which management protocols the
--          local OLT driver supports, CLI template names, private MIB roots.
--          One row per vendor/model combination (global, not org-scoped).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_vendor_capabilities (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    vendor              VARCHAR(50)     NOT NULL
                            COMMENT 'e.g. Huawei, ZTE, VSOL, C-Data, WOLCK, Calix',
    model_pattern       VARCHAR(100)    NOT NULL
                            COMMENT 'SQL LIKE pattern matching device.model, e.g. MA5800%',
    -- Supported management protocols (bitmask stored as JSON array)
    protocols           JSON            NOT NULL
                            COMMENT 'Array of protocols: ["snmp","tl1","netconf","ssh_cli"]',
    snmp_profile_name   VARCHAR(100)    NULL
                            COMMENT 'Matches snmp_profiles.name for this vendor',
    -- CLI template references (config_templates.name)
    provision_template  VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for ONU provisioning CLI',
    firmware_template   VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for firmware upgrade CLI',
    reboot_template     VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for ONU reboot CLI',
    -- NETCONF / TL1 stubs
    netconf_schema      VARCHAR(255)    NULL
                            COMMENT 'Path/URI to YANG schema for this vendor',
    tl1_command_set     VARCHAR(50)     NULL
                            COMMENT 'TL1 dialect variant identifier',
    -- OMCI support
    omci_supported      TINYINT(1)      NOT NULL DEFAULT 0,
    -- Private MIB root OID
    enterprise_oid      VARCHAR(100)    NULL
                            COMMENT 'Root enterprise OID, e.g. 1.3.6.1.4.1.2011 (Huawei)',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_olt_vendor_model (vendor, model_pattern),
    KEY idx_olt_vendor_capabilities_vendor (vendor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-vendor OLT management capability matrix (§7.1)';

-- ---------------------------------------------------------------------------
-- Table: olt_splitters
-- Purpose: PON splitter inventory (1:8, 1:16, 1:32, 1:64, 1:128).
--          Each splitter is located at a site and connected to one OLT port.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_splitters (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    site_id             BIGINT UNSIGNED NULL
                            COMMENT 'Physical site where this splitter is installed',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'Upstream PON port this splitter is connected to',
    ratio               ENUM('1:2','1:4','1:8','1:16','1:32','1:64','1:128')
                            NOT NULL DEFAULT '1:32',
    splitter_type       ENUM('optical','wdm','other') NOT NULL DEFAULT 'optical',
    location_detail     VARCHAR(255)    NULL
                            COMMENT 'Specific location: pole, cabinet, ODF row/column',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','damaged','removed') NOT NULL DEFAULT 'active',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_olt_splitters_organization_id (organization_id),
    KEY idx_olt_splitters_site_id (site_id),
    KEY idx_olt_splitters_olt_port_id (olt_port_id),
    KEY idx_olt_splitters_ratio (ratio),
    KEY idx_olt_splitters_status (status),
    KEY idx_olt_splitters_deleted_at (deleted_at),
    CONSTRAINT fk_olt_splitters_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_splitters_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_splitters_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON splitter inventory (§7.1 splitter management)';

-- ---------------------------------------------------------------------------
-- Add last_provision_job_id FK on onu_details (deferred from migration 266
-- because onu_firmware_jobs needed to exist first).
-- Uses guarded stored-procedure pattern (migration 230 style).
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_267_add_onu_fk;
DELIMITER $$
CREATE PROCEDURE migration_267_add_onu_fk()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA   = DATABASE()
      AND TABLE_NAME     = 'onu_details'
      AND CONSTRAINT_NAME = 'fk_onu_details_provision_job'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE onu_details
      ADD CONSTRAINT fk_onu_details_provision_job
          FOREIGN KEY (last_provision_job_id)
          REFERENCES onu_firmware_jobs (id)
          ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$
DELIMITER ;

CALL migration_267_add_onu_fk();
DROP PROCEDURE IF EXISTS migration_267_add_onu_fk;

-- ---------------------------------------------------------------------------
-- Seed vendor capability rows (INSERT IGNORE — idempotent)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO olt_vendor_capabilities
    (vendor, model_pattern, protocols, snmp_profile_name, omci_supported, enterprise_oid, notes)
VALUES
    (
        'Huawei', 'MA5800%',
        '["snmp","netconf","ssh_cli"]',
        'Huawei OLT', 1,
        '1.3.6.1.4.1.2011',
        'Huawei MA5800 series — HUAWEI-XPON-MIB for PON, NETCONF/YANG for provisioning'
    ),
    (
        'Huawei', 'EA5800%',
        '["snmp","netconf","ssh_cli"]',
        'Huawei OLT', 1,
        '1.3.6.1.4.1.2011',
        'Huawei EA5800 series — same MIB/NETCONF stack as MA5800'
    ),
    (
        'ZTE', 'C300%',
        '["snmp","netconf","tl1","ssh_cli"]',
        'ZTE OLT', 1,
        '1.3.6.1.4.1.3902',
        'ZTE C300/C320/C600 — ZXAN MIB, NETCONF (ZTE YANG), TL1'
    ),
    (
        'ZTE', 'C320%',
        '["snmp","netconf","tl1","ssh_cli"]',
        'ZTE OLT', 1,
        '1.3.6.1.4.1.3902',
        'ZTE C320 — same as C300 stack'
    ),
    (
        'ZTE', 'C600%',
        '["snmp","netconf","tl1","ssh_cli"]',
        'ZTE OLT', 1,
        '1.3.6.1.4.1.3902',
        'ZTE C600 — same as C300 stack, higher capacity'
    ),
    (
        'VSOL', 'V1600%',
        '["snmp","ssh_cli"]',
        NULL, 1,
        '1.3.6.1.4.1.55158',
        'VSOL V1600/W40/W80 — VSOL enterprise MIB; SSH CLI provisioning'
    ),
    (
        'C-Data', '1600%',
        '["snmp","ssh_cli"]',
        NULL, 0,
        '1.3.6.1.4.1.34592',
        'C-Data FD1600 series — SSH CLI; limited SNMP'
    ),
    (
        'C-Data', '9000%',
        '["snmp","ssh_cli"]',
        NULL, 0,
        '1.3.6.1.4.1.34592',
        'C-Data FD9000 series — SSH CLI; limited SNMP'
    ),
    (
        'WOLCK', 'WNM%',
        '["snmp","ssh_cli"]',
        NULL, 0,
        NULL,
        'WOLCK WNM Series — SSH CLI; basic SNMP; no OMCI channel exposed'
    ),
    (
        'Calix', 'E7%',
        '["snmp","netconf","ssh_cli"]',
        NULL, 1,
        '1.3.6.1.4.1.6321',
        'Calix E7 — Calix enterprise MIB; NETCONF/RESTCONF supported'
    );
