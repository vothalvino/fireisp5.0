-- =============================================================================
-- Migration 256: Seed extended SNMP OIDs for device monitoring profiles
-- =============================================================================
-- Implements isp-platform-features.md §6.2 "Extended Device Metrics":
--   Seeds snmp_profile_oids for the new metric columns added in migration 255:
--   voltage_mv, temperature_c, fan_speed_rpm, if_in_discards, if_out_discards,
--   sfp_tx_power_dbm, sfp_rx_power_dbm, sfp_temperature_c, ups_battery_pct,
--   ups_runtime_min, poe_power_mw, humidity_pct.
--
-- Profiles targeted:
--   MikroTik RouterOS  — board temp, supply voltage, fan speed
--   SFP Diagnostics    — SFP temp, Tx/Rx optical power (Juniper ENTITY-SENSOR)
--   Generic Switch     — ifInDiscards, ifOutDiscards, PoE power draw
--   Generic UPS        — battery charge %, estimated runtime
--   Environmental Sensors — humidity, ambient temperature
--
-- Uses INSERT IGNORE — safe to re-run.
-- profile_id resolved by joining snmp_profiles on name (organization_id IS NULL
-- matches the global/system profiles seeded in migration 252).
--
-- Requires:
--   029_create_snmp_profiles_table
--   030_create_snmp_profile_oids_table
--   252_seed_vendor_snmp_profiles
--   255_extend_snmp_metric_columns
-- =============================================================================

-- ---------------------------------------------------------------------------
-- OIDs — MikroTik RouterOS
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.4.1.14988.1.1.3.5'  AS oid, 'temperature_c'  AS metric_column, 'Board Temperature' AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, 30 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.3.9',          'voltage_mv',                     'Supply Voltage',              'gauge',             FALSE,                   31 UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.3.11',          'fan_speed_rpm',                  'Fan 1 Speed',                 'gauge',             FALSE,                   32
) o
WHERE p.name = 'MikroTik RouterOS'
  AND p.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- OIDs — SFP Diagnostics
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.4.1.2636.3.60.1.1.1.1.34' AS oid, 'sfp_temperature_c'  AS metric_column, 'SFP Temperature' AS label, 'gauge' AS oid_type, TRUE AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.2636.3.60.1.1.1.1.7',          'sfp_tx_power_dbm',                   'SFP Tx Power',              'gauge',             TRUE,                   11 UNION ALL
    SELECT '1.3.6.1.4.1.2636.3.60.1.1.1.1.6',          'sfp_rx_power_dbm',                   'SFP Rx Power',              'gauge',             TRUE,                   12
) o
WHERE p.name = 'SFP Diagnostics'
  AND p.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- OIDs — Generic Switch
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.13'           AS oid, 'if_in_discards'  AS metric_column, 'Interface In Discards'  AS label, 'counter' AS oid_type, TRUE AS is_per_interface, 30 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.19',                   'if_out_discards',                 'Interface Out Discards',  'counter',             TRUE,                   31 UNION ALL
    SELECT '1.3.6.1.4.1.9.9.402.1.2.1.14',            'poe_power_mw',                   'PoE Power Draw',          'gauge',               TRUE,                   32
) o
WHERE p.name = 'Generic Switch'
  AND p.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- OIDs — Generic UPS
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.33.1.2.4.0' AS oid, 'ups_battery_pct'  AS metric_column, 'Battery Charge'      AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.33.1.2.3.0',          'ups_runtime_min',                  'Estimated Runtime',    'gauge',             FALSE,                   11
) o
WHERE p.name = 'Generic UPS'
  AND p.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- OIDs — Environmental Sensors
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.4.1.17095.5.2.0' AS oid, 'humidity_pct'   AS metric_column, 'Relative Humidity'    AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, 20 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.17095.5.1.0',          'temperature_c',                  'Ambient Temperature',   'gauge',             FALSE,                   21
) o
WHERE p.name = 'Environmental Sensors'
  AND p.organization_id IS NULL;

-- END OF MIGRATION 256
