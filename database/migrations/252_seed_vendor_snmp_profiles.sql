-- =============================================================================
-- Migration 252: Vendor metric OID profile seeds
-- =============================================================================
-- Implements isp-platform-features.md §6.3 "Traffic Monitoring":
--   Seeds snmp_profiles and snmp_profile_oids for additional vendors and
--   device classes: Cisco IOS, Juniper JunOS, Huawei VRP, ZTE ZXAN,
--   Generic Switch, Generic UPS, SFP Diagnostics, and Environmental Sensors.
--
-- Uses INSERT IGNORE throughout — safe to re-run.
-- OID inserts resolve profile_id by joining snmp_profiles on name.
--
-- Requires:
--   029_create_snmp_profiles_table
--   030_create_snmp_profile_oids_table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Cisco IOS',
        'Cisco', NULL, NULL,
        'v2c', 300, FALSE,
        'Cisco IOS/IOS-XE routers and switches. Uses CISCO-PROCESS-MIB, CISCO-MEMORY-POOL-MIB, and standard IF-MIB.'
    ),
    (
        'Juniper JunOS',
        'Juniper', NULL, NULL,
        'v2c', 300, FALSE,
        'Juniper Networks JunOS devices. Uses JUNIPER-MIB and standard IF-MIB.'
    ),
    (
        'Huawei VRP',
        'Huawei', NULL, NULL,
        'v2c', 300, FALSE,
        'Huawei VRP devices (routers, switches, OLTs). Uses HUAWEI-MIB and standard IF-MIB.'
    ),
    (
        'ZTE ZXAN',
        'ZTE', NULL, NULL,
        'v2c', 300, FALSE,
        'ZTE OLT/DSLAM devices. Uses ZTE enterprise MIB and standard IF-MIB.'
    ),
    (
        'Generic Switch',
        NULL, NULL, 'switch',
        'v2c', 300, FALSE,
        'Generic switch profile with port status, errors, and PoE OIDs from RFC 3621 and IF-MIB.'
    ),
    (
        'Generic UPS',
        NULL, NULL, 'other',
        'v2c', 300, FALSE,
        'APC/Eaton/generic UPS via RFC 1628 UPS-MIB and vendor extensions.'
    ),
    (
        'SFP Diagnostics',
        NULL, NULL, 'other',
        'v2c', 60, FALSE,
        'SFP/QSFP optical diagnostics via ENTITY-SENSOR-MIB (RFC 3433) for Tx power, Rx power, temperature.'
    ),
    (
        'Environmental Sensors',
        NULL, NULL, 'other',
        'v2c', 120, FALSE,
        'Environmental sensors (temperature, humidity) via ENTITY-SENSOR-MIB.'
    );

-- ---------------------------------------------------------------------------
-- OIDs — Cisco IOS
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'           AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'                       AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                  'if_out_octets',               'Outbound Octets',                          'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                  'if_in_errors',                'Inbound Errors',                           'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                  'if_out_errors',               'Outbound Errors',                          'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1',       'cpu_usage',                   'CISCO-PROCESS-MIB: cpmCPUTotal5minRev',    'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.9.9.48.1.1.1.5.1',          'memory_usage',                'CISCO-MEMORY-POOL-MIB: ciscoMemoryPoolUsed', 'gauge', FALSE, NULL, 60
) o
WHERE p.name = 'Cisco IOS';

-- ---------------------------------------------------------------------------
-- OIDs — Juniper JunOS
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'           AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'                AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                  'if_out_octets',               'Outbound Octets',                   'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                  'if_in_errors',                'Inbound Errors',                    'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                  'if_out_errors',               'Outbound Errors',                   'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.2636.3.1.13.1.8',           'cpu_usage',                   'Juniper: jnxOperatingCPU',          'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.2636.3.1.13.1.11',          'memory_usage',                'Juniper: jnxOperatingBuffer',       'gauge',   FALSE, NULL, 60
) o
WHERE p.name = 'Juniper JunOS';

-- ---------------------------------------------------------------------------
-- OIDs — Huawei VRP
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'           AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'              AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                  'if_out_octets',               'Outbound Octets',                 'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                  'if_in_errors',                'Inbound Errors',                  'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                  'if_out_errors',               'Outbound Errors',                 'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.2011.6.3.4.1.2',            'cpu_usage',                   'Huawei: hwAvgDuty5min',           'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.2011.6.3.3.1.5',            'memory_usage',                'Huawei: hwEntityMemUsage',        'gauge',   FALSE, NULL, 60
) o
WHERE p.name = 'Huawei VRP';

-- ---------------------------------------------------------------------------
-- OIDs — ZTE ZXAN
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'                AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'                    AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                      'if_out_octets',               'Outbound Octets',                         'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                      'if_in_errors',                'Inbound Errors',                          'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                      'if_out_errors',               'Outbound Errors',                         'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.3902.1012.1.1.2.1.2',           'cpu_usage',                   'ZTE: zxAnSysMgrCpuUsage',                 'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.3902.1012.1.1.2.1.6',           'memory_usage',                'ZTE: zxAnSysMgrMemUsage',                 'gauge',   FALSE, NULL, 60
) o
WHERE p.name = 'ZTE ZXAN';

-- ---------------------------------------------------------------------------
-- OIDs — Generic Switch
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'   AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'                                    AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',          'if_out_octets',               'Outbound Octets',                                       'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',          'if_in_errors',                'Inbound Errors',                                        'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',          'if_out_errors',               'Outbound Errors',                                       'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',        'cpu_usage',                   'HOST-RESOURCES-MIB: hrProcessorLoad',                   'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.2.1.105.1.1.1.3',       'signal_strength',             'PoE Power (mW)',                                        'gauge',   TRUE,  NULL, 60
) o
WHERE p.name = 'Generic Switch';

-- ---------------------------------------------------------------------------
-- OIDs — Generic UPS
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.33.1.4.1.0' AS oid, 'cpu_usage'      AS metric_column, 'UPS-MIB: upsOutputPercentLoad'              AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.33.1.3.1.0',        'memory_usage',                   'UPS-MIB: upsBatteryCapacity',                 'gauge',  FALSE, NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.33.1.2.3.0',        'latency_ms',                     'UPS-MIB: upsEstimatedMinutesRemaining',        'gauge',  FALSE, NULL, 30
) o
WHERE p.name = 'Generic UPS';

-- ---------------------------------------------------------------------------
-- OIDs — SFP Diagnostics
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.99.1.1.1.4' AS oid, 'signal_strength' AS metric_column, 'ENTITY-SENSOR-MIB: entPhySensorValue (Rx Power)'    AS label, 'gauge' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.99.1.1.1.5',        'latency_ms',                       'ENTITY-SENSOR-MIB: entPhySensorPrecision (Tx Power)', 'gauge',  TRUE,  NULL, 20
) o
WHERE p.name = 'SFP Diagnostics';

-- ---------------------------------------------------------------------------
-- OIDs — Environmental Sensors
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.99.1.1.1.4.1' AS oid, 'cpu_usage'    AS metric_column, 'ENTITY-SENSOR-MIB: entPhySensorValue (Temperature)' AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.99.1.1.1.4.2',         'memory_usage',                 'ENTITY-SENSOR-MIB: entPhySensorValue (Humidity)',      'gauge',  FALSE, NULL, 20
) o
WHERE p.name = 'Environmental Sensors';
