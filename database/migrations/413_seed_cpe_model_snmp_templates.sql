-- =============================================================================
-- Migration 413 — model-specific CPE SNMP templates
-- =============================================================================
-- Seeds ready-made SNMP profiles ("what to record") for the four CPE models an
-- operator deploys to subscribers (contract-linked devices):
--
--   1. Ubiquiti LiteBeam 5AC Gen2  (LBE-5AC-Gen2, airMAX AC / airOS 8)
--   2. Ubiquiti PowerBeam M5-400   (PBE-M5-400,   airMAX M  / airOS 6)
--   3. Ubiquiti airCube ISP        (ACB-ISP — NOT airMAX: no radio-stat table)
--   4. Ruijie RG-EW1300G           (Reyee home router)
--
-- OID numbering for the airMAX radio stats follows the CANONICAL
-- UBNT-AirMAX-MIB ubntWlStatTable (1.3.6.1.4.1.41112.1.4.5.1.<col>):
--   .5 Signal   .6 Rssi   .7 Ccq   .8 NoiseFloor   .9 TxRate   .10 RxRate
-- verified against the published MIB (LibreNMS/Observium mirrors). NOTE: the
-- older 'Ubiquiti airOS' seeds (migrations 031/280) use DIFFERENT sub-ids for
-- several of these objects; that profile is left untouched here (flagged as a
-- follow-up) — these templates are self-contained and additive.
--
-- The wlStat table has exactly one row on a CPE (index 1), and the poller
-- fetches scalar OIDs with an exact GET (snmpPoller.js snmpGet) — so radio
-- OIDs are seeded WITH the .1 instance suffix. IF-MIB counters are
-- per-interface walks. CPU uses the migration-401 aggregate walk
-- (hrProcessorLoad averaged); memory uses the 401 hardcoded hrStorage RAM
-- ratio (that row's oid is label-only). Both are HOST-RESOURCES-MIB — present
-- on airOS (net-snmp based); if a given firmware omits them the poller
-- records nothing for that metric and reachability is unaffected.
--
-- Ruijie note: stock RG-EW1300G (Reyee) firmware is cloud-managed and often
-- exposes NO SNMP agent. The template covers standard IF-MIB only, for
-- firmwares/deployments where SNMP is available — if the device never
-- answers, it will simply show as SNMP-unreachable.
--
-- Assignment: profiles are attached per device via devices.snmp_profile_id
-- (manufacturer/model_pattern on the profile are descriptive hints).
-- Idempotent: INSERT IGNORE against uq_snmp_profiles_name /
-- uq_profile_oid(profile_id, oid).
-- =============================================================================

INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Ubiquiti LiteBeam 5AC Gen2',
        'Ubiquiti', '%LBE%5AC%', 'outdoor_cpe',
        'v2c', 300, FALSE,
        'LiteBeam 5AC Gen2 subscriber CPE (airMAX AC, airOS 8). Radio health from the canonical UBNT-AirMAX-MIB ubntWlStatTable (signal/noise/CCQ, single row index 1) + IF-MIB traffic/errors + HOST-RESOURCES CPU/memory.'
    ),
    (
        'Ubiquiti PowerBeam M5-400',
        'Ubiquiti', '%PBE%M5%', 'outdoor_cpe',
        'v2c', 300, FALSE,
        'PowerBeam M5-400 subscriber CPE (airMAX M, airOS 6). Radio health from the canonical UBNT-AirMAX-MIB ubntWlStatTable (signal/noise/CCQ, single row index 1) + IF-MIB traffic/errors + HOST-RESOURCES CPU/memory.'
    ),
    (
        'Ubiquiti airCube ISP',
        'Ubiquiti', '%ACB%', 'indoor_cpe',
        'v2c', 300, FALSE,
        'airCube ISP indoor router/AP (ACB-ISP). NOT an airMAX device — no ubntWlStat radio table; records IF-MIB traffic/errors + HOST-RESOURCES CPU/memory.'
    ),
    (
        'Ruijie RG-EW1300G',
        'Ruijie', '%EW1300G%', 'indoor_cpe',
        'v2c', 300, FALSE,
        'Reyee RG-EW1300G home router. CAUTION: stock Reyee firmware is cloud-managed and may not expose an SNMP agent at all — template applies where SNMP is available. Standard IF-MIB traffic/errors only.'
    );

-- -----------------------------------------------------------------------------
-- Shared IF-MIB traffic/error walks — all four templates
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, FALSE, NULL, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10' AS oid, 'if_in_octets'  AS metric_column, 'Inbound Octets'   AS label, 'counter' AS oid_type, TRUE AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',        'if_out_octets',                  'Outbound Octets',          'counter',             TRUE,                     20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',        'if_in_errors',                   'Inbound Errors',           'counter',             TRUE,                     30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',        'if_out_errors',                  'Outbound Errors',          'counter',             TRUE,                     40
) o
WHERE p.name IN ('Ubiquiti LiteBeam 5AC Gen2', 'Ubiquiti PowerBeam M5-400', 'Ubiquiti airCube ISP', 'Ruijie RG-EW1300G')
  AND p.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- airMAX radio health (canonical ubntWlStatTable, instance .1) — the two
-- airMAX CPEs only
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, 'gauge', FALSE, FALSE, NULL, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.5.1' AS oid, 'signal_strength' AS metric_column, 'airMAX Signal (dBm)'      AS label, 50 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.8.1',        'noise_floor_dbm',                  'airMAX Noise Floor (dBm)',         60 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.7.1',        'ccq_pct',                          'airMAX CCQ (%)',                   70
) o
WHERE p.name IN ('Ubiquiti LiteBeam 5AC Gen2', 'Ubiquiti PowerBeam M5-400')
  AND p.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- HOST-RESOURCES CPU (aggregate walk) + memory (401 RAM-ratio row) — Ubiquiti
-- templates (airOS and airCube are net-snmp based; absent = simply no data)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, '1.3.6.1.2.1.25.3.3.1.2', 'cpu_usage', 'CPU Load Avg (hrProcessorLoad)', 'gauge', TRUE, TRUE, NULL, 80
FROM snmp_profiles p
WHERE p.name IN ('Ubiquiti LiteBeam 5AC Gen2', 'Ubiquiti PowerBeam M5-400', 'Ubiquiti airCube ISP')
  AND p.deleted_at IS NULL;

INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, '1.3.6.1.2.1.25.2.3.1.6', 'memory_usage', 'Memory Used % (hrStorageTable RAM row)', 'gauge', TRUE, FALSE, NULL, 90
FROM snmp_profiles p
WHERE p.name IN ('Ubiquiti LiteBeam 5AC Gen2', 'Ubiquiti PowerBeam M5-400', 'Ubiquiti airCube ISP')
  AND p.deleted_at IS NULL;

-- END OF MIGRATION 413
