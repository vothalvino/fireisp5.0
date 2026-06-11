-- =============================================================================
-- Migration 266: FTTH — OLT & ONU Management tables
-- =============================================================================
-- Implements isp-platform-features.md §7.1 (OLT Management) and
-- §7.2 (ONU Management).
--
-- Design:
--   OLTs and ONUs ARE devices (type='olt'/'onu' in the existing devices table).
--   This migration adds the FTTH-specific detail tables that extend devices with
--   PON/GPON domain knowledge that doesn't belong in the generic devices table.
--
-- Tables created (all guarded with CREATE TABLE IF NOT EXISTS):
--   olt_ports           — PON/uplink port inventory per OLT device
--   onu_profiles        — PON profile templates (T-CONT/GEM/DBA/VLAN maps)
--   onu_details         — GPON-specific ONU fields (SN, LOID, profile, status…)
--   onu_optical_metrics — Per-ONU optical diagnostics time-series (Tx/Rx/temp…)
--   onu_whitelist       — MAC / SN allow+block list
--   onu_omci_configs    — OMCI / TR-069 Wi-Fi / bridge-router config records
--   onu_firmware_jobs   — Batch firmware upgrade scheduler
--
-- All org-scoped tables: organization_id BIGINT UNSIGNED NULL + FK + deleted_at.
-- FKs to devices reference devices.id (BIGINT UNSIGNED).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: olt_ports
-- Purpose: Physical PON and uplink ports on an OLT device.
--          Stores Tx/Rx optical power polled from SNMP, ONU count per port,
--          bandwidth utilization, and admin/oper state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_ports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant scoping — NULL = single-tenant deployment',
    olt_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''olt'')',
    port_index          INT UNSIGNED    NOT NULL
                            COMMENT 'IF-MIB ifIndex or vendor PON slot/port index',
    port_name           VARCHAR(50)     NOT NULL
                            COMMENT 'Human-readable name, e.g. GPON 0/1/3',
    port_type           ENUM('gpon','epon','xgspon','uplink','cascade','other')
                            NOT NULL DEFAULT 'gpon',
    slot_no             TINYINT UNSIGNED NULL
                            COMMENT 'Board/slot number on the OLT chassis',
    port_no             TINYINT UNSIGNED NULL
                            COMMENT 'Port number within the slot',
    admin_status        ENUM('up','down') NOT NULL DEFAULT 'up'
                            COMMENT 'Administratively configured state',
    oper_status         ENUM('up','down','testing','unknown','notPresent','lowerLayerDown')
                            NOT NULL DEFAULT 'unknown'
                            COMMENT 'Current operational state from SNMP ifOperStatus',
    onu_count           SMALLINT UNSIGNED NULL DEFAULT 0
                            COMMENT 'Active ONUs registered on this PON port (polled)',
    max_onus            SMALLINT UNSIGNED NULL DEFAULT 128
                            COMMENT 'Maximum ONUs supported (1:128 splitter)',
    tx_power_dbm        DECIMAL(6,2)    NULL
                            COMMENT 'PON port Tx optical power in dBm (polled)',
    rx_power_dbm        DECIMAL(6,2)    NULL
                            COMMENT 'PON port Rx optical power in dBm (polled)',
    bandwidth_up_bps    BIGINT UNSIGNED NULL
                            COMMENT 'Uplink bandwidth utilization in bps (polled)',
    bandwidth_down_bps  BIGINT UNSIGNED NULL
                            COMMENT 'Downlink bandwidth utilization in bps (polled)',
    last_polled_at      DATETIME        NULL
                            COMMENT 'Last time port metrics were polled from device',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_olt_ports_device_port (olt_device_id, port_index),
    KEY idx_olt_ports_organization_id (organization_id),
    KEY idx_olt_ports_olt_device_id (olt_device_id),
    KEY idx_olt_ports_port_type (port_type),
    KEY idx_olt_ports_oper_status (oper_status),
    KEY idx_olt_ports_deleted_at (deleted_at),
    CONSTRAINT fk_olt_ports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_ports_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON and uplink port inventory per OLT (§7.1)';

-- ---------------------------------------------------------------------------
-- Table: onu_profiles
-- Purpose: PON service profiles — T-CONT / GEM port / DBA / VLAN mapping
--          templates. A profile is assigned to one or more ONUs via onu_details.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_profiles (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    technology          ENUM('gpon','epon','xgspon','other')
                            NOT NULL DEFAULT 'gpon',
    -- T-CONT / DBA
    tcont_id            TINYINT UNSIGNED NULL
                            COMMENT 'T-CONT index (GPON/XGSPON)',
    dba_profile_name    VARCHAR(100)    NULL
                            COMMENT 'Bandwidth assurance profile name on OLT',
    assured_bw_kbps     INT UNSIGNED    NULL
                            COMMENT 'Assured bandwidth in kbps (DBA type 3/4)',
    max_bw_kbps         INT UNSIGNED    NULL
                            COMMENT 'Maximum/peak bandwidth in kbps',
    -- GEM port
    gem_port_id         SMALLINT UNSIGNED NULL
                            COMMENT 'GEM port ID for service traffic (0-4095)',
    -- VLAN mapping
    service_vlan        SMALLINT UNSIGNED NULL
                            COMMENT 'S-VLAN (outer tag) for this service profile',
    client_vlan         SMALLINT UNSIGNED NULL
                            COMMENT 'C-VLAN (inner tag) for this service profile',
    vlan_mode           ENUM('transparent','tag','translate','double_tag','untagged')
                            NOT NULL DEFAULT 'tag',
    -- Service plan linkage
    plan_id             BIGINT UNSIGNED NULL
                            COMMENT 'Service plan associated with this PON profile',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_profiles_org_name (organization_id, name),
    KEY idx_onu_profiles_organization_id (organization_id),
    KEY idx_onu_profiles_technology (technology),
    KEY idx_onu_profiles_plan_id (plan_id),
    KEY idx_onu_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_onu_profiles_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_profiles_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON service profile templates (T-CONT/GEM/DBA/VLAN) (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_details
-- Purpose: GPON-specific ONU fields that extend the generic devices row.
--          One row per ONU device (one-to-one with devices WHERE type=''onu'').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_details (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'') — the ONU device',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — the parent OLT',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — the PON port this ONU is on',
    onu_profile_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_profiles — active service profile',
    -- Registration identity
    serial_number       VARCHAR(20)     NULL
                            COMMENT 'ONU serial number in PLOAM/OMCI format (e.g. HWTC1A2B3C4D)',
    loid                VARCHAR(64)     NULL
                            COMMENT 'Logical ONU ID used for LOID authentication',
    loid_password_encrypted VARCHAR(255) NULL
                            COMMENT 'LOID password — AES-256 encrypted at app layer',
    -- ONU status (polled or pushed via trap)
    onu_state           ENUM('online','offline','los','dying_gasp','power_off','loc','unconfigured','unknown')
                            NOT NULL DEFAULT 'unknown'
                            COMMENT 'Current PON layer operational state of the ONU',
    last_status_at      DATETIME        NULL
                            COMMENT 'Timestamp of last status update',
    -- OLT-assigned addressing
    onu_id              SMALLINT UNSIGNED NULL
                            COMMENT 'OLT-assigned ONU identifier (0-127 on GPON)',
    ranging_distance_m  INT UNSIGNED    NULL
                            COMMENT 'ONU distance measured by OLT ranging in metres',
    -- Vendor profile references (CLI/NETCONF template names stored on the OLT)
    line_profile_name   VARCHAR(100)    NULL
                            COMMENT 'OLT line-profile name assigned to this ONU',
    service_profile_name VARCHAR(100)   NULL
                            COMMENT 'OLT service-profile name assigned to this ONU',
    -- Bridge/Router mode
    wan_mode            ENUM('bridge','router','mixed')
                            NOT NULL DEFAULT 'bridge'
                            COMMENT 'ONU WAN forwarding mode',
    -- Pending provision job reference
    last_provision_job_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_firmware_jobs — last provision/config job',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_details_device_id (device_id),
    KEY idx_onu_details_organization_id (organization_id),
    KEY idx_onu_details_olt_device_id (olt_device_id),
    KEY idx_onu_details_olt_port_id (olt_port_id),
    KEY idx_onu_details_onu_profile_id (onu_profile_id),
    KEY idx_onu_details_onu_state (onu_state),
    KEY idx_onu_details_serial_number (serial_number),
    KEY idx_onu_details_deleted_at (deleted_at),
    CONSTRAINT fk_onu_details_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_onu_profile FOREIGN KEY (onu_profile_id)
        REFERENCES onu_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='GPON/EPON ONU detail extension to devices (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_optical_metrics
-- Purpose: Per-ONU optical diagnostics time-series.
--          Tx power, Rx power, temperature, voltage, bias current.
--          Stored as a ring-buffer; old rows pruned by scheduled_tasks cleanup.
--          NOT partitioned (low write rate vs snmp_metrics).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_optical_metrics (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'')',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'')',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports',
    polled_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'Timestamp of the measurement',
    -- Optical power (0.01 dBm resolution)
    tx_power_dbm        DECIMAL(6,2)    NULL COMMENT 'ONU Tx optical power (dBm)',
    rx_power_dbm        DECIMAL(6,2)    NULL COMMENT 'ONU Rx optical power at OLT (dBm)',
    -- Laser diagnostics (SFP DDM / OMCI)
    temperature_c       DECIMAL(6,2)    NULL COMMENT 'Laser temperature in °C',
    voltage_v           DECIMAL(6,3)    NULL COMMENT 'Laser supply voltage in V',
    bias_current_ma     DECIMAL(8,3)    NULL COMMENT 'Laser bias current in mA',
    -- OLT-side Rx power for this ONU (from HUAWEI-XPON-MIB or ZTE MIB)
    olt_rx_power_dbm    DECIMAL(6,2)    NULL COMMENT 'OLT-side Rx optical power (dBm)',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_onu_optical_device_polled (device_id, polled_at DESC),
    KEY idx_onu_optical_organization (organization_id),
    KEY idx_onu_optical_olt_port (olt_port_id),
    KEY idx_onu_optical_polled_at (polled_at)
    -- No FKs: high-write metrics table (same pattern as snmp_metrics).
    -- Org-id stored for filtering; olt_port_id stored for queries.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-ONU optical diagnostic time-series (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_whitelist
-- Purpose: MAC or serial-number allow/block list per OLT.
--          Controls whether an ONU discovered on a PON port may auto-provision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_whitelist (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    olt_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''olt'') owning this list',
    entry_type          ENUM('mac','serial_number') NOT NULL DEFAULT 'serial_number',
    entry_value         VARCHAR(64)     NOT NULL
                            COMMENT 'MAC address (XX:XX:XX:XX:XX:XX) or SN string',
    list_type           ENUM('allow','block') NOT NULL DEFAULT 'allow',
    device_id           BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''onu'') if already provisioned',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_whitelist_olt_entry (olt_device_id, entry_type, entry_value),
    KEY idx_onu_whitelist_organization_id (organization_id),
    KEY idx_onu_whitelist_olt_device_id (olt_device_id),
    KEY idx_onu_whitelist_list_type (list_type),
    KEY idx_onu_whitelist_device_id (device_id),
    KEY idx_onu_whitelist_deleted_at (deleted_at),
    CONSTRAINT fk_onu_whitelist_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_whitelist_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_whitelist_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU MAC/SN allow-block list per OLT (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_omci_configs
-- Purpose: OMCI-style (or TR-069 placeholder) Wi-Fi SSID/password and
--          bridge/router mode config records per ONU.
--          The application layer records desired config here; actual delivery
--          over OMCI or TR-069 is handled by the provisioning job layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_omci_configs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'')',
    -- Config classification
    config_type         ENUM('wifi','wan','lan','voip','omci_raw','tr069','other')
                            NOT NULL DEFAULT 'wifi',
    -- Wi-Fi
    wifi_ssid           VARCHAR(64)     NULL,
    wifi_password_encrypted VARCHAR(512) NULL
                            COMMENT 'Wi-Fi PSK — AES-256 encrypted at app layer',
    wifi_band           ENUM('2.4ghz','5ghz','both') NULL DEFAULT 'both',
    wifi_channel        TINYINT UNSIGNED NULL,
    wifi_security       ENUM('open','wep','wpa2','wpa3') NULL DEFAULT 'wpa2',
    -- WAN mode
    wan_mode            ENUM('bridge','router','mixed') NULL,
    wan_ip_mode         ENUM('dhcp','static','pppoe') NULL,
    wan_ip_address      VARCHAR(45)     NULL,
    wan_netmask         VARCHAR(45)     NULL,
    wan_gateway         VARCHAR(45)     NULL,
    -- Delivery
    delivery_method     ENUM('omci','tr069','ssh_cli','manual','pending')
                            NOT NULL DEFAULT 'pending',
    applied_at          DATETIME        NULL
                            COMMENT 'Timestamp when this config was successfully pushed',
    apply_status        ENUM('pending','in_progress','applied','failed','superseded')
                            NOT NULL DEFAULT 'pending',
    apply_error         TEXT            NULL,
    -- Raw config blob for custom OMCI ME sequences or TR-069 parameter sets
    raw_config          JSON            NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_omci_configs_organization_id (organization_id),
    KEY idx_onu_omci_configs_device_id (device_id),
    KEY idx_onu_omci_configs_config_type (config_type),
    KEY idx_onu_omci_configs_apply_status (apply_status),
    KEY idx_onu_omci_configs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_omci_configs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_omci_configs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OMCI / TR-069 Wi-Fi and WAN config records per ONU (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_firmware_jobs
-- Purpose: Batch firmware upgrade and reboot job scheduler per OLT/region.
--          Also used for single-ONU reboot commands.
--          Actual device I/O is handled by a background worker that reads
--          job rows and records results back here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_firmware_jobs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    job_type            ENUM('firmware_upgrade','reboot','provision','factory_reset','other')
                            NOT NULL DEFAULT 'firmware_upgrade',
    -- Scope: either a single ONU, or all ONUs on a PON port, or all under an OLT
    scope               ENUM('single_onu','olt_port','olt_device','region','all')
                            NOT NULL DEFAULT 'single_onu',
    onu_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''onu'') for single-ONU scope',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') for OLT-level scope',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports for PON-port-level scope',
    -- Firmware details (firmware_upgrade jobs)
    firmware_version    VARCHAR(100)    NULL
                            COMMENT 'Target firmware version string',
    firmware_url        VARCHAR(1024)   NULL
                            COMMENT 'HTTP/TFTP URL to firmware image',
    -- Scheduling
    scheduled_at        DATETIME        NULL
                            COMMENT 'Scheduled start time; NULL = execute immediately',
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    -- Status tracking
    status              ENUM('pending','queued','in_progress','completed','failed','cancelled','partial')
                            NOT NULL DEFAULT 'pending',
    total_devices       INT UNSIGNED    NULL DEFAULT 0,
    completed_devices   INT UNSIGNED    NULL DEFAULT 0,
    failed_devices      INT UNSIGNED    NULL DEFAULT 0,
    result_summary      JSON            NULL
                            COMMENT 'Per-ONU result map { "device_id": "status" }',
    error_message       TEXT            NULL,
    -- Created by
    created_by          BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — operator who created this job',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_firmware_jobs_organization_id (organization_id),
    KEY idx_onu_firmware_jobs_onu_device_id (onu_device_id),
    KEY idx_onu_firmware_jobs_olt_device_id (olt_device_id),
    KEY idx_onu_firmware_jobs_olt_port_id (olt_port_id),
    KEY idx_onu_firmware_jobs_status (status),
    KEY idx_onu_firmware_jobs_scheduled_at (scheduled_at),
    KEY idx_onu_firmware_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_firmware_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_onu_device FOREIGN KEY (onu_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU firmware upgrade and reboot job scheduler (§7.2)';
