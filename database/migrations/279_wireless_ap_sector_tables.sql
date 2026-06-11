-- =============================================================================
-- Migration 279: Wireless/WISP Sector & AP Management Tables — §9.1
-- =============================================================================
-- Implements isp-platform-features.md §9.1 Sector/AP Management:
--   • ap_channel_plans    — channel assignment registry per site
--   • ap_sector_configs   — AP-specific wireless attributes linked to devices
--   • wireless_client_sessions — snapshot of CPE client state per AP poll
--   • ap_command_jobs     — recorded AP remote command jobs
--   • wireless_channel_interference — detected interference records
--
-- Also adds RF metric columns to snmp_metrics + rollup tables (guarded ALTERs):
--   snmp_metrics:       noise_floor_dbm, air_util_pct, gps_sync_status, snr_db,
--                       ccq_pct, tx_rate_mbps, rx_rate_mbps
--   snmp_metrics_1hr/1day/1month: matching avg/min/max columns
--
-- All CREATE TABLE uses CREATE TABLE IF NOT EXISTS.
-- All ALTER TABLE columns are guarded via stored procedure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: ap_channel_plans
-- Purpose: Channel assignment registry per site — records which frequency and
--          channel width are assigned to a site sector for conflict avoidance.
--          Created before ap_sector_configs so the FK can reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_channel_plans (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    site_id         BIGINT UNSIGNED NOT NULL COMMENT 'Site this channel plan belongs to',
    name            VARCHAR(100)    NOT NULL COMMENT 'Descriptive name for this channel plan',
    frequency_mhz   INT             NOT NULL COMMENT 'Center frequency in MHz (e.g. 5180, 5785)',
    channel_width_mhz SMALLINT      NOT NULL COMMENT 'Channel width in MHz (e.g. 20, 40, 80)',
    notes           TEXT            NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_channel_plans_organization_id (organization_id),
    KEY idx_ap_channel_plans_site_id (site_id),
    KEY idx_ap_channel_plans_status (status),
    KEY idx_ap_channel_plans_deleted_at (deleted_at),
    CONSTRAINT fk_ap_channel_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_channel_plans_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Channel assignment registry per site for AP frequency planning';

-- ---------------------------------------------------------------------------
-- Table: ap_sector_configs
-- Purpose: AP-specific wireless attributes linked to devices of type ptmp_ap
--          or ptp. Stores RF configuration (frequency, channel, power,
--          polarization, encryption) for each sector/AP device.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_sector_configs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    device_id           BIGINT UNSIGNED NOT NULL COMMENT 'AP/PTP device (type=ptmp_ap or ptp)',
    sector_azimuth_deg  SMALLINT        NULL     COMMENT 'Sector azimuth bearing in degrees (0–359)',
    sector_width_deg    SMALLINT        NULL     COMMENT 'Sector beam width in degrees',
    frequency_mhz       INT             NULL     COMMENT 'Operating frequency in MHz',
    channel_width_mhz   SMALLINT        NULL     COMMENT 'Channel width in MHz',
    tx_power_dbm        SMALLINT        NULL     COMMENT 'Transmit power in dBm',
    encryption          ENUM('none','wpa2','wpa3','mixed') NOT NULL DEFAULT 'wpa2'
                            COMMENT 'Wireless encryption mode',
    channel_plan_id     BIGINT UNSIGNED NULL     COMMENT 'FK to ap_channel_plans (nullable)',
    antenna_gain_dbi    DECIMAL(4,1)    NULL     COMMENT 'Antenna gain in dBi',
    height_m            DECIMAL(5,1)    NULL     COMMENT 'Antenna height above ground in metres',
    polarization        ENUM('vertical','horizontal','dual','cross') NULL
                            COMMENT 'Antenna polarization',
    max_clients         SMALLINT        NULL     COMMENT 'Maximum subscriber connections per sector',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_sector_configs_organization_id (organization_id),
    KEY idx_ap_sector_configs_device_id (device_id),
    KEY idx_ap_sector_configs_channel_plan_id (channel_plan_id),
    KEY idx_ap_sector_configs_deleted_at (deleted_at),
    CONSTRAINT fk_ap_sector_configs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_sector_configs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ap_sector_configs_channel_plan FOREIGN KEY (channel_plan_id)
        REFERENCES ap_channel_plans (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AP/PTP wireless RF configuration per sector device';

-- ---------------------------------------------------------------------------
-- Table: wireless_client_sessions
-- Purpose: Snapshot of CPE/client state per AP poll — one row per MAC address
--          per observation. Append-only (no deleted_at). Captures signal, SNR,
--          CCQ, throughput rates, and distance for each associated client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wireless_client_sessions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    device_id           BIGINT UNSIGNED NOT NULL COMMENT 'AP device that observed this client',
    client_device_id    BIGINT UNSIGNED NULL     COMMENT 'CPE device record (NULL if unknown)',
    mac_address         VARCHAR(17)     NOT NULL COMMENT 'Client MAC address (AA:BB:CC:DD:EE:FF)',
    ip_address          VARCHAR(45)     NULL     COMMENT 'Client IP address (IPv4 or IPv6)',
    signal_dbm          SMALLINT        NULL     COMMENT 'Received signal level in dBm',
    noise_floor_dbm     SMALLINT        NULL     COMMENT 'Noise floor at AP in dBm',
    snr_db              SMALLINT        NULL     COMMENT 'Signal-to-noise ratio in dB',
    ccq_pct             SMALLINT        NULL     COMMENT 'Client Connection Quality percentage (0–100)',
    tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Transmit rate in Mbps',
    rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Receive rate in Mbps',
    distance_m          INT             NULL     COMMENT 'Distance from AP in metres',
    connected_at        DATETIME        NULL     COMMENT 'Session association time (NULL if unknown)',
    last_seen_at        DATETIME        NOT NULL COMMENT 'Timestamp of this observation',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_wcs_organization_id (organization_id),
    KEY idx_wcs_device_id (device_id),
    KEY idx_wcs_client_device_id (client_device_id),
    KEY idx_wcs_mac_address (mac_address),
    KEY idx_wcs_last_seen_at (last_seen_at),
    CONSTRAINT fk_wcs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wcs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_wcs_client_device FOREIGN KEY (client_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only CPE client state snapshots per AP poll';

-- ---------------------------------------------------------------------------
-- Table: ap_command_jobs
-- Purpose: Recorded AP remote command jobs for power/frequency/channel
--          adjustments and reboots. Supports scheduled execution and audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_command_jobs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    device_id       BIGINT UNSIGNED NOT NULL COMMENT 'Target AP/PTP device',
    command_type    ENUM('set_tx_power','set_frequency','set_channel_width','reboot','other')
                        NOT NULL DEFAULT 'other'
                        COMMENT 'Type of remote command to execute',
    target_value    VARCHAR(255)    NULL     COMMENT 'Target value for the command (e.g. new frequency)',
    status          ENUM('pending','queued','in_progress','completed','failed','cancelled')
                        NOT NULL DEFAULT 'pending',
    scheduled_at    DATETIME        NULL     COMMENT 'When the command should execute (NULL = immediate)',
    started_at      DATETIME        NULL     COMMENT 'When execution started',
    completed_at    DATETIME        NULL     COMMENT 'When execution completed or failed',
    result_output   TEXT            NULL     COMMENT 'Device response / stdout',
    error_message   TEXT            NULL     COMMENT 'Error detail on failure',
    created_by      BIGINT UNSIGNED NULL     COMMENT 'User who created this job (no FK — soft ref)',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_command_jobs_organization_id (organization_id),
    KEY idx_ap_command_jobs_device_id (device_id),
    KEY idx_ap_command_jobs_status (status),
    KEY idx_ap_command_jobs_scheduled_at (scheduled_at),
    KEY idx_ap_command_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_ap_command_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_command_jobs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Remote AP command jobs for power/frequency/reboot adjustments';

-- ---------------------------------------------------------------------------
-- Table: wireless_channel_interference
-- Purpose: Detected RF interference records per sector/site. Used for
--          channel planning and interference source tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wireless_channel_interference (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    ap_sector_config_id BIGINT UNSIGNED NULL     COMMENT 'AP sector where interference was detected',
    site_id             BIGINT UNSIGNED NULL     COMMENT 'Site where interference was detected',
    detected_at         DATETIME        NOT NULL COMMENT 'When interference was observed',
    frequency_mhz       INT             NULL     COMMENT 'Affected frequency in MHz',
    channel_width_mhz   SMALLINT        NULL     COMMENT 'Affected channel width in MHz',
    interference_level  ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    conflicting_ap_mac  VARCHAR(17)     NULL     COMMENT 'MAC of the conflicting AP if known',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_wci_organization_id (organization_id),
    KEY idx_wci_ap_sector_config_id (ap_sector_config_id),
    KEY idx_wci_site_id (site_id),
    KEY idx_wci_detected_at (detected_at),
    KEY idx_wci_interference_level (interference_level),
    KEY idx_wci_deleted_at (deleted_at),
    CONSTRAINT fk_wci_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wci_ap_sector_config FOREIGN KEY (ap_sector_config_id)
        REFERENCES ap_sector_configs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wci_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Detected RF channel interference records per sector/site';

-- ---------------------------------------------------------------------------
-- Part 2: Add RF metric columns to snmp_metrics and rollup tables
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_279_add_rf_metrics;
DELIMITER $$
CREATE PROCEDURE migration_279_add_rf_metrics()
BEGIN
  -- snmp_metrics: noise_floor_dbm
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN noise_floor_dbm SMALLINT NULL
        COMMENT '§9.1 RF noise floor in dBm'
        AFTER if_oper_status;
  END IF;

  -- snmp_metrics: air_util_pct
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'air_util_pct'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN air_util_pct TINYINT NULL
        COMMENT '§9.1 Airtime utilization percentage (0–100)'
        AFTER noise_floor_dbm;
  END IF;

  -- snmp_metrics: gps_sync_status
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'gps_sync_status'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN gps_sync_status TINYINT NULL
        COMMENT '§9.1 GPS sync status: 1=synced 0=not-synced'
        AFTER air_util_pct;
  END IF;

  -- snmp_metrics: snr_db
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'snr_db'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN snr_db SMALLINT NULL
        COMMENT '§9.1 Signal-to-noise ratio in dB'
        AFTER gps_sync_status;
  END IF;

  -- snmp_metrics: ccq_pct
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'ccq_pct'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN ccq_pct SMALLINT NULL
        COMMENT '§9.1 Client Connection Quality percentage (0–100)'
        AFTER snr_db;
  END IF;

  -- snmp_metrics: tx_rate_mbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'tx_rate_mbps'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN tx_rate_mbps DECIMAL(8,2) NULL
        COMMENT '§9.1 Wireless transmit modulation rate in Mbps'
        AFTER ccq_pct;
  END IF;

  -- snmp_metrics: rx_rate_mbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'rx_rate_mbps'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN rx_rate_mbps DECIMAL(8,2) NULL
        COMMENT '§9.1 Wireless receive modulation rate in Mbps'
        AFTER tx_rate_mbps;
  END IF;

  -- -------------------------------------------------------------------------
  -- snmp_metrics_1hr: avg/min/max for all 7 RF metrics
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1hr'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1hr
      ADD COLUMN avg_noise_floor_dbm  DECIMAL(7,2)  NULL COMMENT 'Average noise floor dBm',
      ADD COLUMN min_noise_floor_dbm  SMALLINT      NULL COMMENT 'Min noise floor dBm',
      ADD COLUMN max_noise_floor_dbm  SMALLINT      NULL COMMENT 'Max noise floor dBm',
      ADD COLUMN avg_air_util_pct     DECIMAL(5,2)  NULL COMMENT 'Average airtime utilization %',
      ADD COLUMN min_air_util_pct     TINYINT       NULL COMMENT 'Min airtime utilization %',
      ADD COLUMN max_air_util_pct     TINYINT       NULL COMMENT 'Max airtime utilization %',
      ADD COLUMN avg_gps_sync_status  DECIMAL(4,2)  NULL COMMENT 'Average GPS sync status',
      ADD COLUMN min_gps_sync_status  TINYINT       NULL COMMENT 'Min GPS sync status',
      ADD COLUMN max_gps_sync_status  TINYINT       NULL COMMENT 'Max GPS sync status',
      ADD COLUMN avg_snr_db           DECIMAL(7,2)  NULL COMMENT 'Average SNR dB',
      ADD COLUMN min_snr_db           SMALLINT      NULL COMMENT 'Min SNR dB',
      ADD COLUMN max_snr_db           SMALLINT      NULL COMMENT 'Max SNR dB',
      ADD COLUMN avg_ccq_pct          DECIMAL(5,2)  NULL COMMENT 'Average CCQ %',
      ADD COLUMN min_ccq_pct          SMALLINT      NULL COMMENT 'Min CCQ %',
      ADD COLUMN max_ccq_pct          SMALLINT      NULL COMMENT 'Max CCQ %',
      ADD COLUMN avg_tx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Tx rate Mbps',
      ADD COLUMN min_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Tx rate Mbps',
      ADD COLUMN max_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Tx rate Mbps',
      ADD COLUMN avg_rx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Rx rate Mbps',
      ADD COLUMN min_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Rx rate Mbps',
      ADD COLUMN max_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Rx rate Mbps';
  END IF;

  -- -------------------------------------------------------------------------
  -- snmp_metrics_1day: avg/min/max for all 7 RF metrics
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1day'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1day
      ADD COLUMN avg_noise_floor_dbm  DECIMAL(7,2)  NULL COMMENT 'Average noise floor dBm',
      ADD COLUMN min_noise_floor_dbm  SMALLINT      NULL COMMENT 'Min noise floor dBm',
      ADD COLUMN max_noise_floor_dbm  SMALLINT      NULL COMMENT 'Max noise floor dBm',
      ADD COLUMN avg_air_util_pct     DECIMAL(5,2)  NULL COMMENT 'Average airtime utilization %',
      ADD COLUMN min_air_util_pct     TINYINT       NULL COMMENT 'Min airtime utilization %',
      ADD COLUMN max_air_util_pct     TINYINT       NULL COMMENT 'Max airtime utilization %',
      ADD COLUMN avg_gps_sync_status  DECIMAL(4,2)  NULL COMMENT 'Average GPS sync status',
      ADD COLUMN min_gps_sync_status  TINYINT       NULL COMMENT 'Min GPS sync status',
      ADD COLUMN max_gps_sync_status  TINYINT       NULL COMMENT 'Max GPS sync status',
      ADD COLUMN avg_snr_db           DECIMAL(7,2)  NULL COMMENT 'Average SNR dB',
      ADD COLUMN min_snr_db           SMALLINT      NULL COMMENT 'Min SNR dB',
      ADD COLUMN max_snr_db           SMALLINT      NULL COMMENT 'Max SNR dB',
      ADD COLUMN avg_ccq_pct          DECIMAL(5,2)  NULL COMMENT 'Average CCQ %',
      ADD COLUMN min_ccq_pct          SMALLINT      NULL COMMENT 'Min CCQ %',
      ADD COLUMN max_ccq_pct          SMALLINT      NULL COMMENT 'Max CCQ %',
      ADD COLUMN avg_tx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Tx rate Mbps',
      ADD COLUMN min_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Tx rate Mbps',
      ADD COLUMN max_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Tx rate Mbps',
      ADD COLUMN avg_rx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Rx rate Mbps',
      ADD COLUMN min_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Rx rate Mbps',
      ADD COLUMN max_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Rx rate Mbps';
  END IF;

  -- -------------------------------------------------------------------------
  -- snmp_metrics_1month: avg/min/max for all 7 RF metrics
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1month'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1month
      ADD COLUMN avg_noise_floor_dbm  DECIMAL(7,2)  NULL COMMENT 'Average noise floor dBm',
      ADD COLUMN min_noise_floor_dbm  SMALLINT      NULL COMMENT 'Min noise floor dBm',
      ADD COLUMN max_noise_floor_dbm  SMALLINT      NULL COMMENT 'Max noise floor dBm',
      ADD COLUMN avg_air_util_pct     DECIMAL(5,2)  NULL COMMENT 'Average airtime utilization %',
      ADD COLUMN min_air_util_pct     TINYINT       NULL COMMENT 'Min airtime utilization %',
      ADD COLUMN max_air_util_pct     TINYINT       NULL COMMENT 'Max airtime utilization %',
      ADD COLUMN avg_gps_sync_status  DECIMAL(4,2)  NULL COMMENT 'Average GPS sync status',
      ADD COLUMN min_gps_sync_status  TINYINT       NULL COMMENT 'Min GPS sync status',
      ADD COLUMN max_gps_sync_status  TINYINT       NULL COMMENT 'Max GPS sync status',
      ADD COLUMN avg_snr_db           DECIMAL(7,2)  NULL COMMENT 'Average SNR dB',
      ADD COLUMN min_snr_db           SMALLINT      NULL COMMENT 'Min SNR dB',
      ADD COLUMN max_snr_db           SMALLINT      NULL COMMENT 'Max SNR dB',
      ADD COLUMN avg_ccq_pct          DECIMAL(5,2)  NULL COMMENT 'Average CCQ %',
      ADD COLUMN min_ccq_pct          SMALLINT      NULL COMMENT 'Min CCQ %',
      ADD COLUMN max_ccq_pct          SMALLINT      NULL COMMENT 'Max CCQ %',
      ADD COLUMN avg_tx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Tx rate Mbps',
      ADD COLUMN min_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Tx rate Mbps',
      ADD COLUMN max_tx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Tx rate Mbps',
      ADD COLUMN avg_rx_rate_mbps     DECIMAL(10,4) NULL COMMENT 'Average Rx rate Mbps',
      ADD COLUMN min_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Min Rx rate Mbps',
      ADD COLUMN max_rx_rate_mbps     DECIMAL(8,2)  NULL COMMENT 'Max Rx rate Mbps';
  END IF;
END$$
DELIMITER ;

CALL migration_279_add_rf_metrics();
DROP PROCEDURE IF EXISTS migration_279_add_rf_metrics;
