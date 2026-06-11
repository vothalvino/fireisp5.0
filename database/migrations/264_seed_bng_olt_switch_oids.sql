-- =============================================================================
-- Migration 264: Cisco/Juniper BNG, Huawei/ZTE OLT, and Switch vendor OID seeds
-- =============================================================================
-- Implements isp-platform-features.md §6.2 gaps:
--   • "Cisco/Juniper BNG: interface stats, sessions, CPU, memory"
--   • "Huawei/ZTE OLT monitoring (private MIBs where available)"
--   • "Switch monitoring: port status, errors, utilization, PoE status"
--
-- Adds:
--   1. if_oper_status column to snmp_metrics (ifOperStatus: 1=up, 2=down,
--      3=testing, 7=lowerLayerDown) — guarded ALTER via stored procedure.
--   2. Matching avg/min/max columns on snmp_metrics_1hr and snmp_metrics_1day.
--   3. New snmp_profiles for Cisco BNG, Juniper BNG, Huawei OLT, ZTE OLT.
--   4. OID rows for all four new profiles plus extended switch OIDs.
--
-- All INSERTs use INSERT IGNORE — idempotent/safe to re-run.
-- Profile resolution: JOIN snmp_profiles on name (globally unique key).
--
-- Requires:
--   029_create_snmp_profiles_table
--   030_create_snmp_profile_oids_table
--   252_seed_vendor_snmp_profiles
--   255_extend_snmp_metric_columns
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Add if_oper_status to snmp_metrics and rollup tables
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_264_add_oper_status;
DELIMITER $$
CREATE PROCEDURE migration_264_add_oper_status()
BEGIN
  -- snmp_metrics.if_oper_status
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN if_oper_status TINYINT NULL
        COMMENT 'IF-MIB ifOperStatus: 1=up 2=down 3=testing 7=lowerLayerDown'
        AFTER poe_power_mw;
  END IF;

  -- snmp_metrics_1hr: avg/min/max for if_oper_status
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1hr'
      AND COLUMN_NAME  = 'avg_if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics_1hr
      ADD COLUMN avg_if_oper_status DECIMAL(4,2) NULL
        COMMENT 'Average ifOperStatus in the period (1=up ... 2=down)',
      ADD COLUMN min_if_oper_status TINYINT      NULL
        COMMENT 'Min ifOperStatus in the period',
      ADD COLUMN max_if_oper_status TINYINT      NULL
        COMMENT 'Max ifOperStatus in the period';
  END IF;

  -- snmp_metrics_1day: avg/min/max for if_oper_status
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1day'
      AND COLUMN_NAME  = 'avg_if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics_1day
      ADD COLUMN avg_if_oper_status DECIMAL(4,2) NULL
        COMMENT 'Average ifOperStatus in the period',
      ADD COLUMN min_if_oper_status TINYINT      NULL
        COMMENT 'Min ifOperStatus in the period',
      ADD COLUMN max_if_oper_status TINYINT      NULL
        COMMENT 'Max ifOperStatus in the period';
  END IF;
END$$
DELIMITER ;

CALL migration_264_add_oper_status();
DROP PROCEDURE IF EXISTS migration_264_add_oper_status;

-- ---------------------------------------------------------------------------
-- Part 2: New snmp_profiles — Cisco BNG, Juniper BNG, Huawei OLT, ZTE OLT
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Cisco BNG',
        'Cisco', 'ASR100[0-9]|ASR900[0-9]', 'router',
        'v2c', 300, FALSE,
        'Cisco Broadband Network Gateway (ASR1000/ASR9000). '
        'Uses CISCO-PROCESS-MIB cpmCPU*, CISCO-MEMORY-POOL-MIB, '
        'CISCO-SUBSCRIBER-SESSION-MIB for active sessions, '
        'and standard IF-MIB for interface throughput/errors.'
    ),
    (
        'Juniper BNG',
        'Juniper', 'MX[0-9]|ERX', 'router',
        'v2c', 300, FALSE,
        'Juniper Networks BNG/BRAS (MX-series, ERX). '
        'Uses JUNIPER-MIB jnxOperating* for CPU/memory, '
        'JUNIPER-SUBSCRIBER-MIB for session counts, '
        'and standard IF-MIB.'
    ),
    (
        'Huawei OLT',
        'Huawei', 'MA5800|EA5800|MA5600', 'other',
        'v2c', 300, FALSE,
        'Huawei MA5800/EA5800 GPON OLT. '
        'Uses HUAWEI-XPON-MIB for ONU counts and PON port Rx power, '
        'standard IF-MIB for uplink interface traffic, '
        'and HUAWEI-ENTITY-EXTENT-MIB for CPU/memory/temperature.'
    ),
    (
        'ZTE OLT',
        'ZTE', 'C300|C320|C600|ZXA10', 'other',
        'v2c', 300, FALSE,
        'ZTE C300/C320/C600 GPON OLT. '
        'Uses ZTE ZXAN enterprise MIB (1.3.6.1.4.1.3902) for CPU/memory '
        'and ONU registration, plus standard IF-MIB for uplink traffic.'
    );

-- ---------------------------------------------------------------------------
-- Part 3: OIDs — Cisco BNG
-- ---------------------------------------------------------------------------
-- CPU:         CISCO-PROCESS-MIB cpmCPUTotalTable — index 1 (CPU 0)
--              1.3.6.1.4.1.9.9.109.1.1.1.1.8.1 (cpmCPUTotal5minRev)
-- Memory:      CISCO-MEMORY-POOL-MIB ciscoMemoryPoolUsed
--              1.3.6.1.4.1.9.9.48.1.1.1.5.1 (IO memory pool)
-- Interfaces:  Standard IF-MIB (ifInOctets/ifOutOctets/ifInErrors/ifOutErrors)
--              IF-MIB ifHCInOctets/ifHCOutOctets for 64-bit counters
--              1.3.6.1.2.1.31.1.1.1.6 / 1.3.6.1.2.1.31.1.1.1.10
-- Sessions:    CISCO-SUBSCRIBER-SESSION-MIB
--              1.3.6.1.4.1.9.9.441.1.2.1.1.3 (csubJobMatchCurrentlyActiveSessions)
--              Mapped to signal_strength (closest integer metric column)
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
    -- Interface throughput (64-bit IF-MIB counters)
    SELECT '1.3.6.1.2.1.31.1.1.1.6'            AS oid, 'if_in_octets'   AS metric_column, 'ifHCInOctets (64-bit)'                   AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.31.1.1.1.10',                  'if_out_octets',               'ifHCOutOctets (64-bit)',                   'counter', TRUE,  20 UNION ALL
    -- Interface errors and discards
    SELECT '1.3.6.1.2.1.2.2.1.14',                     'if_in_errors',                'ifInErrors',                              'counter', TRUE,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                     'if_out_errors',               'ifOutErrors',                             'counter', TRUE,  40 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.13',                     'if_in_discards',              'ifInDiscards',                            'counter', TRUE,  50 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.19',                     'if_out_discards',             'ifOutDiscards',                           'counter', TRUE,  60 UNION ALL
    -- Port operational status
    SELECT '1.3.6.1.2.1.2.2.1.8',                      'if_oper_status',              'ifOperStatus (1=up 2=down)',               'gauge',   TRUE,  70 UNION ALL
    -- CPU (CISCO-PROCESS-MIB: cpmCPUTotal5minRev, CPU instance 1)
    SELECT '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1',          'cpu_usage',                   'CISCO-PROCESS-MIB: cpmCPUTotal5minRev',   'gauge',   FALSE, 80 UNION ALL
    -- Memory (CISCO-MEMORY-POOL-MIB: ciscoMemoryPoolUsed, IO pool)
    SELECT '1.3.6.1.4.1.9.9.48.1.1.1.5.1',             'memory_usage',                'CISCO-MEMORY-POOL-MIB: ciscoMemoryPoolUsed', 'gauge', FALSE, 90 UNION ALL
    -- Active subscriber sessions (CISCO-SUBSCRIBER-SESSION-MIB)
    SELECT '1.3.6.1.4.1.9.9.441.1.2.1.1.3.1',          'signal_strength',             'Cisco: csubJobMatchCurrentlyActiveSessions', 'gauge', FALSE, 100
) o
WHERE p.name = 'Cisco BNG';

-- ---------------------------------------------------------------------------
-- Part 4: OIDs — Juniper BNG
-- ---------------------------------------------------------------------------
-- CPU:      JUNIPER-MIB jnxOperatingCPU
--           1.3.6.1.4.1.2636.3.1.13.1.8 (jnxOperatingCPU, index 9.1.0)
-- Memory:   JUNIPER-MIB jnxOperatingBuffer (memory buffer utilization %)
--           1.3.6.1.4.1.2636.3.1.13.1.11
-- Sessions: JUNIPER-SUBSCRIBER-MIB jnxSubscriberActiveCount
--           1.3.6.1.4.1.2636.3.57.2.1.1.1 (total active sessions scalar)
-- IF-MIB:   ifHCInOctets/ifHCOutOctets (64-bit) + errors + discards
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
    SELECT '1.3.6.1.2.1.31.1.1.1.6'            AS oid, 'if_in_octets'   AS metric_column, 'ifHCInOctets (64-bit)'                        AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.31.1.1.1.10',                  'if_out_octets',               'ifHCOutOctets (64-bit)',                          'counter', TRUE,  20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                     'if_in_errors',                'ifInErrors',                                     'counter', TRUE,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                     'if_out_errors',               'ifOutErrors',                                    'counter', TRUE,  40 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.13',                     'if_in_discards',              'ifInDiscards',                                   'counter', TRUE,  50 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.19',                     'if_out_discards',             'ifOutDiscards',                                  'counter', TRUE,  60 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.8',                      'if_oper_status',              'ifOperStatus (1=up 2=down)',                      'gauge',   TRUE,  70 UNION ALL
    -- CPU: jnxOperatingCPU (FPC slot 9, item 1, sub-item 0 = Routing Engine)
    SELECT '1.3.6.1.4.1.2636.3.1.13.1.8.9.1.0',        'cpu_usage',                   'Juniper: jnxOperatingCPU (RE)',                  'gauge',   FALSE, 80 UNION ALL
    -- Memory: jnxOperatingBuffer (%)
    SELECT '1.3.6.1.4.1.2636.3.1.13.1.11.9.1.0',       'memory_usage',                'Juniper: jnxOperatingBuffer (RE)',               'gauge',   FALSE, 90 UNION ALL
    -- Active subscriber sessions scalar
    SELECT '1.3.6.1.4.1.2636.3.57.2.1.1.1.0',          'signal_strength',             'Juniper: jnxSubscriberActiveCount',              'gauge',   FALSE, 100
) o
WHERE p.name = 'Juniper BNG';

-- ---------------------------------------------------------------------------
-- Part 5: OIDs — Huawei OLT
-- ---------------------------------------------------------------------------
-- HUAWEI-XPON-MIB (1.3.6.1.4.1.2011.6.128):
--   hwGponDeviceOltOpticaRxPower: PON port Rx power table
--     1.3.6.1.4.1.2011.6.128.1.1.2.46.1.6 (hwGponDeviceOltOpticaRxPower)
--   hwGponOntNumber: active ONU count per PON port
--     1.3.6.1.4.1.2011.6.128.1.1.1.4.1.23 (hwGponDeviceOltOpticaActivePonCount)
-- HUAWEI-ENTITY-EXTENT-MIB (1.3.6.1.4.1.2011.6.3):
--   CPU: hwEntityCPUUsage    1.3.6.1.4.1.2011.6.3.4.1.2
--   MEM: hwEntityMemUsage    1.3.6.1.4.1.2011.6.3.3.1.5
--   TMP: hwEntityTemperature 1.3.6.1.4.1.2011.6.3.3.1.12
-- IF-MIB: uplink interfaces
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
    -- Uplink interface traffic
    SELECT '1.3.6.1.2.1.31.1.1.1.6'                      AS oid, 'if_in_octets'   AS metric_column, 'ifHCInOctets'                                   AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.31.1.1.1.10',                           'if_out_octets',               'ifHCOutOctets',                                   'counter', TRUE,  20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                              'if_in_errors',                'ifInErrors',                                      'counter', TRUE,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                              'if_out_errors',               'ifOutErrors',                                     'counter', TRUE,  40 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.8',                               'if_oper_status',              'ifOperStatus (1=up 2=down)',                       'gauge',   TRUE,  50 UNION ALL
    -- CPU (HUAWEI-ENTITY-EXTENT-MIB hwEntityCPUUsage, slot 1)
    SELECT '1.3.6.1.4.1.2011.6.3.4.1.2',                        'cpu_usage',                   'Huawei: hwEntityCPUUsage',                        'gauge',   FALSE, 60 UNION ALL
    -- Memory (hwEntityMemUsage %)
    SELECT '1.3.6.1.4.1.2011.6.3.3.1.5',                        'memory_usage',                'Huawei: hwEntityMemUsage',                        'gauge',   FALSE, 70 UNION ALL
    -- Board temperature (Celsius)
    SELECT '1.3.6.1.4.1.2011.6.3.3.1.12',                       'temperature_c',               'Huawei: hwEntityTemperature',                     'gauge',   FALSE, 80 UNION ALL
    -- PON port Rx optical power (0.01 dBm units — polled per-interface)
    SELECT '1.3.6.1.4.1.2011.6.128.1.1.2.46.1.6',               'sfp_rx_power_dbm',            'Huawei XPON: hwGponDeviceOltOpticaRxPower',        'gauge',   TRUE,  90 UNION ALL
    -- Active ONU count per PON port
    SELECT '1.3.6.1.4.1.2011.6.128.1.1.1.4.1.23',               'signal_strength',             'Huawei XPON: OLT active ONU count',               'gauge',   TRUE,  100
) o
WHERE p.name = 'Huawei OLT';

-- ---------------------------------------------------------------------------
-- Part 6: OIDs — ZTE OLT
-- ---------------------------------------------------------------------------
-- ZTE ZXAN enterprise OID base: 1.3.6.1.4.1.3902
-- CPU:      zxAnSysMgrCpuUsage  1.3.6.1.4.1.3902.1012.1.1.2.1.2
-- Memory:   zxAnSysMgrMemUsage  1.3.6.1.4.1.3902.1012.1.1.2.1.6
-- ONU count per PON port:
--   zxAnGponOltOtdrStatusOnuNum  1.3.6.1.4.1.3902.1015.3.1.1.1.2
-- PON Tx power:
--   zxAnGponOltPhyTxPowerIndex   1.3.6.1.4.1.3902.1015.3.2.1.1.9
-- IF-MIB uplink traffic
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
    -- Uplink interface traffic
    SELECT '1.3.6.1.2.1.31.1.1.1.6'                      AS oid, 'if_in_octets'   AS metric_column, 'ifHCInOctets'                           AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.31.1.1.1.10',                           'if_out_octets',               'ifHCOutOctets',                           'counter', TRUE,  20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                              'if_in_errors',                'ifInErrors',                              'counter', TRUE,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                              'if_out_errors',               'ifOutErrors',                             'counter', TRUE,  40 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.8',                               'if_oper_status',              'ifOperStatus (1=up 2=down)',               'gauge',   TRUE,  50 UNION ALL
    -- ZTE CPU & memory
    SELECT '1.3.6.1.4.1.3902.1012.1.1.2.1.2',                   'cpu_usage',                   'ZTE: zxAnSysMgrCpuUsage',                 'gauge',   FALSE, 60 UNION ALL
    SELECT '1.3.6.1.4.1.3902.1012.1.1.2.1.6',                   'memory_usage',                'ZTE: zxAnSysMgrMemUsage',                 'gauge',   FALSE, 70 UNION ALL
    -- ONU count per PON port (active ONUs)
    SELECT '1.3.6.1.4.1.3902.1015.3.1.1.1.2',                   'signal_strength',             'ZTE GPON: ONU count per PON port',        'gauge',   TRUE,  80 UNION ALL
    -- PON Tx power (0.01 dBm units)
    SELECT '1.3.6.1.4.1.3902.1015.3.2.1.1.9',                   'sfp_tx_power_dbm',            'ZTE GPON: PON port Tx power',             'gauge',   TRUE,  90
) o
WHERE p.name = 'ZTE OLT';

-- ---------------------------------------------------------------------------
-- Part 7: Extended switch OIDs on the existing Generic Switch profile
-- ---------------------------------------------------------------------------
-- The existing Generic Switch profile (mig-252) has IF-MIB base OIDs.
-- This adds:
--   ifOperStatus  — per-port up/down status
--   ifInDiscards  — per-port ingress discards (EtherLike alignment errors
--                   approximate via ifInDiscards)
--   ifOutDiscards — per-port egress discards
--   ifHCInOctets  — 64-bit ingress octet counter (replaces 32-bit for 1 GE+)
--   ifHCOutOctets — 64-bit egress octet counter
--   pethPsePortDetectionStatus (POWER-ETHERNET-MIB RFC 3621)
--     1.3.6.1.2.1.105.1.1.1.6 — PoE port detection status
--     (1=disabled 2=searching 3=deliveringPower 4=fault 5=test 6=otherFault)
--     Stored in poe_power_mw (best available integer column for status code)
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
    -- 64-bit counters for 1 GE+ ports
    SELECT '1.3.6.1.2.1.31.1.1.1.6'            AS oid, 'if_in_octets'   AS metric_column, 'ifHCInOctets (64-bit in octets)'          AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, 11 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.31.1.1.1.10',                  'if_out_octets',               'ifHCOutOctets (64-bit out octets)',          'counter', TRUE,  21 UNION ALL
    -- Port operational status
    SELECT '1.3.6.1.2.1.2.2.1.8',                      'if_oper_status',              'ifOperStatus (1=up 2=down)',                 'gauge',   TRUE,  35 UNION ALL
    -- Discards
    SELECT '1.3.6.1.2.1.2.2.1.13',                     'if_in_discards',              'ifInDiscards',                              'counter', TRUE,  45 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.19',                     'if_out_discards',             'ifOutDiscards',                             'counter', TRUE,  55 UNION ALL
    -- PoE detection status (POWER-ETHERNET-MIB RFC 3621)
    SELECT '1.3.6.1.2.1.105.1.1.1.6',                  'poe_power_mw',                'POWER-ETHERNET-MIB: pethPsePortDetectionStatus', 'gauge', TRUE,  65
) o
WHERE p.name = 'Generic Switch';
