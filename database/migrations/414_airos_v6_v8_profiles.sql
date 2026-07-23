-- =============================================================================
-- Migration 414 — airOS v6/v8-correct SNMP profiles
-- =============================================================================
-- Follow-up to migration 413's canonical-MIB finding, and makes the Ubiquiti
-- profile set explicitly "airOS v6 AND v8 ready":
--
-- 1. The stock 'Ubiquiti airOS' profile (seeded by 031/280) polls OIDs whose
--    canonical UBNT-AirMAX-MIB meaning is NOT what the rows claim:
--      .1.2  claimed CPU        → is ubntWlStatSsid   (a string)
--      .1.4  claimed memory     → is ubntWlStatApMac  (a MAC)   [280 also
--            re-claimed .1.4 as noise; blocked by the (profile,oid) unique key]
--      .1.5  signal but WITHOUT the .1 instance — the poller's exact GET on a
--            bare column OID returns noSuchInstance
--      .1.6  claimed SNR        → is ubntWlStatRssi
--      .1.7  claimed airtime    → is ubntWlStatCcq
--      .1.11 claimed CCQ        → is ubntWlStatSecurity (a string)
--      .1.19/.1.20 claimed rates → do not exist (rates are .9/.10); their
--            'divide1000' transform also doesn't match the poller's
--            "value / N" expression grammar
--    That profile can never have produced correct radio metrics. It is
--    corrected IN PLACE (existing devices pointing at it start recording real
--    values) and renamed 'Ubiquiti airOS v6 (airMAX M)' to make the firmware
--    branch explicit.
--
-- 2. A new generic 'Ubiquiti airOS v8 (airMAX AC)' profile: on AC firmware,
--    Signal/Noise still come from ubntWlStatTable, but CCQ is an M-series
--    metric — AC's link-quality figure is airMAX Quality (AMQ,
--    ubntAirMaxQuality 1.3.6.1.4.1.41112.1.4.6.1.3, instance .1), recorded
--    into the same ccq_pct column with an AC-explicit label.
--
-- 3. The LiteBeam 5AC Gen2 model template (413) is v8-only hardware — its
--    wlStat CCQ row is replaced with AMQ. The PowerBeam M5-400 template is
--    v6-only hardware and stays on wlStat CCQ (already correct).
--
-- Row removal is a SOFT delete (deleted_at = NOW()); the poller filters
-- deleted_at IS NULL and the (profile_id, oid, active_flag) unique key frees
-- the slot for the corrected row. Idempotent: deletes are guarded by
-- deleted_at IS NULL, inserts by INSERT IGNORE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Soft-delete the mis-mapped rows on the stock airOS profile
-- ---------------------------------------------------------------------------
UPDATE snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
   SET spo.deleted_at = NOW()
 WHERE p.name IN ('Ubiquiti airOS', 'Ubiquiti airOS v6 (airMAX M)')
   AND p.deleted_at IS NULL
   AND spo.deleted_at IS NULL
   AND spo.oid IN (
     '1.3.6.1.4.1.41112.1.4.5.1.2',
     '1.3.6.1.4.1.41112.1.4.5.1.4',
     '1.3.6.1.4.1.41112.1.4.5.1.5',
     '1.3.6.1.4.1.41112.1.4.5.1.6',
     '1.3.6.1.4.1.41112.1.4.5.1.7',
     '1.3.6.1.4.1.41112.1.4.5.1.11',
     '1.3.6.1.4.1.41112.1.4.5.1.19',
     '1.3.6.1.4.1.41112.1.4.5.1.20'
   );

-- ---------------------------------------------------------------------------
-- 1b. Rename the stock profile to make the firmware branch explicit
-- ---------------------------------------------------------------------------
UPDATE snmp_profiles
   SET name = 'Ubiquiti airOS v6 (airMAX M)',
       description = 'airMAX M-series CPEs/APs on airOS v6 (PowerBeam M, NanoStation M, Rocket M…). Canonical UBNT-AirMAX-MIB ubntWlStatTable radio health (Signal/Noise/CCQ) + IF-MIB traffic/errors + HOST-RESOURCES CPU/memory. For AC hardware (airOS v8) use the v8 profile.'
 WHERE name = 'Ubiquiti airOS'
   AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 1c. Canonical rows for the (renamed) v6 profile
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, 'gauge', o.is_per_interface, o.aggregate, NULL, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.5.1' AS oid, 'signal_strength' AS metric_column, 'airMAX Signal (dBm)'      AS label, FALSE AS is_per_interface, FALSE AS aggregate, 50 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.8.1',        'noise_floor_dbm',                  'airMAX Noise Floor (dBm)',         FALSE,                     FALSE,              60 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.7.1',        'ccq_pct',                          'airMAX CCQ (%)',                   FALSE,                     FALSE,              70 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',               'cpu_usage',                        'CPU Load Avg (hrProcessorLoad)',   TRUE,                      TRUE,               80 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',               'memory_usage',                     'Memory Used % (hrStorageTable RAM row)', TRUE,                FALSE,              90
) o
WHERE p.name = 'Ubiquiti airOS v6 (airMAX M)'
  AND p.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. New generic airOS v8 (airMAX AC) profile
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES (
    'Ubiquiti airOS v8 (airMAX AC)',
    'Ubiquiti', '%AC%', NULL,
    'v2c', 300, FALSE,
    'airMAX AC CPEs/APs on airOS v8 (LiteBeam AC, PowerBeam AC, NanoBeam AC…). Signal/Noise from ubntWlStatTable; link quality is airMAX Quality (AMQ — CCQ is an M-series metric) + IF-MIB traffic/errors + HOST-RESOURCES CPU/memory.'
);

INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, o.aggregate, NULL, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10' AS oid, 'if_in_octets'  AS metric_column, 'Inbound Octets'            AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, FALSE AS aggregate, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',        'if_out_octets',                  'Outbound Octets',                   'counter',             TRUE,                      FALSE,              20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',        'if_in_errors',                   'Inbound Errors',                    'counter',             TRUE,                      FALSE,              30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',        'if_out_errors',                  'Outbound Errors',                   'counter',             TRUE,                      FALSE,              40 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.5.1', 'signal_strength',              'airMAX Signal (dBm)',               'gauge',               FALSE,                     FALSE,              50 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.8.1', 'noise_floor_dbm',              'airMAX Noise Floor (dBm)',          'gauge',               FALSE,                     FALSE,              60 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.6.1.3.1', 'ccq_pct',                      'airMAX AC Quality — AMQ (%)',       'gauge',               FALSE,                     FALSE,              70 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',        'cpu_usage',                    'CPU Load Avg (hrProcessorLoad)',    'gauge',               TRUE,                      TRUE,               80 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',        'memory_usage',                 'Memory Used % (hrStorageTable RAM row)', 'gauge',          TRUE,                      FALSE,              90
) o
WHERE p.name = 'Ubiquiti airOS v8 (airMAX AC)'
  AND p.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. LiteBeam 5AC Gen2 template (v8-only hardware): wlStat CCQ → AMQ
-- ---------------------------------------------------------------------------
UPDATE snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
   SET spo.deleted_at = NOW()
 WHERE p.name = 'Ubiquiti LiteBeam 5AC Gen2'
   AND p.deleted_at IS NULL
   AND spo.deleted_at IS NULL
   AND spo.oid = '1.3.6.1.4.1.41112.1.4.5.1.7.1';

INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, '1.3.6.1.4.1.41112.1.4.6.1.3.1', 'ccq_pct', 'airMAX AC Quality — AMQ (%)', 'gauge', FALSE, FALSE, NULL, 70
FROM snmp_profiles p
WHERE p.name = 'Ubiquiti LiteBeam 5AC Gen2'
  AND p.deleted_at IS NULL;

-- END OF MIGRATION 414
