-- =============================================================================
-- Rollback 284: Remove spectrum_scan_results, GPS sync OIDs, AP sector poll task
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Drop spectrum_scan_results table
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS spectrum_scan_results;

-- ---------------------------------------------------------------------------
-- Part 2: Remove GPS sync OID from Ubiquiti airOS profile
-- ---------------------------------------------------------------------------
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name = 'Ubiquiti airOS'
  AND spo.oid = '1.3.6.1.4.1.41112.1.6.1.2.1.5'
  AND spo.metric_column = 'gps_sync_status';

-- ---------------------------------------------------------------------------
-- Part 3: Remove GPS sync OID from Mimosa Networks profile
-- ---------------------------------------------------------------------------
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name = 'Mimosa Networks'
  AND spo.oid = '1.3.6.1.4.1.43356.2.1.2.1.1.8'
  AND spo.metric_column = 'gps_sync_status';

-- ---------------------------------------------------------------------------
-- Part 4: Remove AP sector poll scheduled task
-- ---------------------------------------------------------------------------
DELETE FROM scheduled_tasks WHERE task_name = 'wireless_ap_sector_poll';
