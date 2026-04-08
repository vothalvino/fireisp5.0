-- Migration: 031_seed_snmp_profiles
-- Description: Seeds snmp_profiles and snmp_profile_oids with pre-built OID
--              mappings for the most common ISP device vendors:
--                  a) Generic IF-MIB (default fallback, is_default = TRUE)
--                  b) Ubiquiti airOS  (manufacturer = 'Ubiquiti')
--                  c) MikroTik RouterOS (manufacturer = 'MikroTik')
--                  d) Cambium Networks  (manufacturer = 'Cambium')
--
-- Uses INSERT IGNORE so re-running this migration is safe.
--
-- Requires:    029_create_snmp_profiles_table
--              030_create_snmp_profile_oids_table

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Generic IF-MIB',
        NULL, NULL, NULL,
        'v2c', 300, TRUE,
        'Default fallback profile using standard IF-MIB (RFC 2863) and HOST-RESOURCES-MIB (RFC 2790) OIDs. Applied to any device that does not match a more specific profile.'
    ),
    (
        'Ubiquiti airOS',
        'Ubiquiti', NULL, NULL,
        'v2c', 300, FALSE,
        'Ubiquiti airOS devices (airMAX, airFiber). Uses Ubiquiti enterprise MIB (OID prefix 1.3.6.1.4.1.41112) for signal strength, CPU, and memory in addition to standard IF-MIB interface counters.'
    ),
    (
        'MikroTik RouterOS',
        'MikroTik', NULL, NULL,
        'v2c', 300, FALSE,
        'MikroTik RouterOS devices. Uses MikroTik enterprise MIB (OID prefix 1.3.6.1.4.1.14988) for wireless signal strength in addition to standard IF-MIB interface counters and HOST-RESOURCES-MIB CPU/memory.'
    ),
    (
        'Cambium Networks',
        'Cambium', NULL, NULL,
        'v2c', 300, FALSE,
        'Cambium Networks devices (ePMP, PMP, cnPilot). Uses Cambium enterprise MIB (OID prefix 1.3.6.1.4.1.161) for RSSI and CPU in addition to standard IF-MIB interface counters.'
    );

-- ---------------------------------------------------------------------------
-- OIDs — Generic IF-MIB (profile_id resolved by name)
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
    SELECT '1.3.6.1.2.1.2.2.1.10'   AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'          AS label, 'counter'  AS oid_type, TRUE  AS is_per_interface, NULL        AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',         'if_out_octets',               'Outbound Octets',            'counter',  TRUE,  NULL,  20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',         'if_in_errors',                'Inbound Errors',             'counter',  TRUE,  NULL,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',         'if_out_errors',               'Outbound Errors',            'counter',  TRUE,  NULL,  40 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',       'cpu_usage',                   'CPU Usage (%)',              'gauge',    FALSE, NULL,  50 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',       'memory_usage',                'Memory Used (storage units)', 'gauge',    FALSE, NULL,  60
) o
WHERE p.name = 'Generic IF-MIB';

-- ---------------------------------------------------------------------------
-- OIDs — Ubiquiti airOS
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
    SELECT '1.3.6.1.2.1.2.2.1.10'         AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'     AS label, 'counter'  AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',               'if_out_octets',               'Outbound Octets',         'counter',  TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',               'if_in_errors',                'Inbound Errors',          'counter',  TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',               'if_out_errors',               'Outbound Errors',         'counter',  TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.5',        'signal_strength',             'airOS Signal (dBm)',      'gauge',    FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.2',        'cpu_usage',                   'airOS CPU (%)',           'gauge',    FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.4',        'memory_usage',                'airOS Memory (%)',        'gauge',    FALSE, NULL, 70
) o
WHERE p.name = 'Ubiquiti airOS';

-- ---------------------------------------------------------------------------
-- OIDs — MikroTik RouterOS
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
    SELECT '1.3.6.1.2.1.2.2.1.10'              AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'            AS label, 'counter'  AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                    'if_out_octets',               'Outbound Octets',               'counter',  TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                    'if_in_errors',                'Inbound Errors',                'counter',  TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                    'if_out_errors',               'Outbound Errors',               'counter',  TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',                  'cpu_usage',                   'CPU Usage (HOST-RESOURCES)',    'gauge',    FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',                  'memory_usage',                'Memory Used (hrStorageUsed)',   'gauge',    FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.1.2.1.3',           'signal_strength',             'RouterOS Wireless Signal (dBm)', 'gauge',   FALSE, NULL, 70
) o
WHERE p.name = 'MikroTik RouterOS';

-- ---------------------------------------------------------------------------
-- OIDs — Cambium Networks
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
    SELECT '1.3.6.1.2.1.2.2.1.10'              AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'    AS label, 'counter'  AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                    'if_out_octets',               'Outbound Octets',        'counter',  TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                    'if_in_errors',                'Inbound Errors',         'counter',  TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                    'if_out_errors',               'Outbound Errors',        'counter',  TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.161.19.3.2.2.117.0',          'signal_strength',             'Cambium RSSI (dBm)',     'gauge',    FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.161.19.3.1.4.1.0',            'cpu_usage',                   'Cambium CPU (%)',        'gauge',    FALSE, NULL, 60
) o
WHERE p.name = 'Cambium Networks';
