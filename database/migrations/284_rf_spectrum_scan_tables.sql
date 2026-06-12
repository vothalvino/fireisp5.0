-- =============================================================================
-- Migration 284: RF Spectrum Scan Tables + GPS Sync OID Seeds + AP Sector Poll Task
-- =============================================================================
-- Creates spectrum_scan_results table for AP spectrum scan storage.
-- Adds GPS sync monitoring OIDs for Ubiquiti airOS and Mimosa Networks profiles.
-- Seeds a scheduled task for AP sector status polling (wireless_ap_sector_poll).
--
-- Note: RF metric columns (noise_floor_dbm, air_util_pct, gps_sync_status) were
-- already added to snmp_metrics and snmp_metrics_1month in migration 279.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Create spectrum_scan_results table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spectrum_scan_results (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    device_id               BIGINT UNSIGNED NOT NULL  COMMENT 'AP device that performed the scan',
    scan_type               ENUM('scheduled','manual','triggered') NOT NULL DEFAULT 'manual',
    frequency_start_mhz     INT             NOT NULL,
    frequency_end_mhz       INT             NOT NULL,
    channel_width_mhz       SMALLINT        NOT NULL DEFAULT 20,
    -- Scan results stored as JSON array of {freq_mhz, power_dbm} objects
    scan_data               JSON            NULL      COMMENT 'Raw spectrum data: [{freq_mhz: N, power_dbm: N}]',
    peak_interference_dbm   DECIMAL(7,2)    NULL,
    recommended_channel_mhz INT             NULL      COMMENT 'Clearest channel identified',
    status                  ENUM('pending','in_progress','completed','failed') NOT NULL DEFAULT 'pending',
    started_at              DATETIME        NULL,
    completed_at            DATETIME        NULL,
    error_message           TEXT            NULL,
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_spectrum_scans_device (device_id),
    KEY idx_spectrum_scans_org (organization_id),
    KEY idx_spectrum_scans_status (status),
    KEY idx_spectrum_scans_deleted_at (deleted_at),
    CONSTRAINT fk_spectrum_scans_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_spectrum_scans_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AP spectrum scan results — raw scan_data JSON + recommendation (§9.3)';

-- ---------------------------------------------------------------------------
-- Part 2: GPS sync OID seeds for Ubiquiti airOS
-- ---------------------------------------------------------------------------
-- OID reference (airMAX TDMA MIB — ubntAirIf table):
--   ubntAirIfGpsSync  1.3.6.1.4.1.41112.1.6.1.2.1.5  (GPS sync status: 1=synced, 0=not)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    '1.3.6.1.4.1.41112.1.6.1.2.1.5',
    'gps_sync_status',
    'airMAX GPS Sync (1=synced)',
    'gauge',
    FALSE,
    NULL,
    140
FROM snmp_profiles p
WHERE p.name = 'Ubiquiti airOS';

-- ---------------------------------------------------------------------------
-- Part 3: GPS sync OID seed for Mimosa Networks
-- ---------------------------------------------------------------------------
-- OID reference (Mimosa enterprise MIB):
--   mimosaGpsSync  1.3.6.1.4.1.43356.2.1.2.1.1.8  (GPS sync: 1=synced, 0=not synced)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    '1.3.6.1.4.1.43356.2.1.2.1.1.8',
    'gps_sync_status',
    'Mimosa GPS Sync (1=synced)',
    'gauge',
    FALSE,
    NULL,
    115
FROM snmp_profiles p
WHERE p.name = 'Mimosa Networks';

-- ---------------------------------------------------------------------------
-- Part 4: Seed scheduled task for AP sector status polling
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (task_name, task_type, cron_expression, priority, is_enabled, description)
SELECT
    'wireless_ap_sector_poll',
    'snmp_poll',
    '*/5 * * * *',
    'normal',
    TRUE,
    'Poll AP sector metrics: noise floor, air utilization, connected clients, GPS sync'
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks WHERE task_name = 'wireless_ap_sector_poll'
);
