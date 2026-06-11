-- =============================================================================
-- Migration 280: Wireless Vendor SNMP Profile and OID Seeds — §9.1
-- =============================================================================
-- Adds snmp_profiles for Mimosa Networks, Tarana Wireless, Radwin, and Siklu.
-- Extends existing Ubiquiti airOS and MikroTik RouterOS profiles with RF metrics:
--   noise_floor_dbm, ccq_pct, air_util_pct (where OIDs are publicly known).
-- Adds full OID sets for all four new vendors using their enterprise MIB prefixes.
--
-- All INSERTs use INSERT IGNORE — idempotent/safe to re-run.
-- Profile resolution: JOIN snmp_profiles on name (globally unique key).
--
-- Requires:
--   029_create_snmp_profiles_table
--   030_create_snmp_profile_oids_table
--   252_seed_vendor_snmp_profiles
--   279_wireless_ap_sector_tables (adds RF metric columns)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: New snmp_profiles for Mimosa, Tarana, Radwin, Siklu
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Mimosa Networks',
        'Mimosa', 'A[2-9]|B[2-9]|C[2-9]', NULL,
        'v2c', 60, FALSE,
        'Mimosa Networks A/B/C-series wireless backhaul and PTMP access points. '
        'Uses Mimosa enterprise MIB (OID prefix 1.3.6.1.4.1.43356) for signal, '
        'noise floor, CCQ, air utilization, and modulation rates. '
        'Supports 2.4 GHz, 5 GHz, and 60 GHz bands.'
    ),
    (
        'Tarana Wireless',
        'Tarana', 'G1|G1A|G1B', NULL,
        'v2c', 60, FALSE,
        'Tarana Wireless G1 fixed wireless access system. '
        'Uses Tarana enterprise MIB (OID prefix 1.3.6.1.4.1.50536) for DL/UL signal, '
        'noise floor, SNR, and GPS sync status. '
        'Designed for NLOS subscriber connections up to 10 km.'
    ),
    (
        'Radwin',
        'Radwin', '2000|5000|JET', NULL,
        'v2c', 60, FALSE,
        'Radwin 2000/5000 series PTP/PTMP wireless broadband systems. '
        'Uses Radwin enterprise MIB (OID prefix 1.3.6.1.4.1.4329) for signal, '
        'modulation, airtime utilization, and Tx power. '
        'Supports sub-6 GHz and 60 GHz E-band configurations.'
    ),
    (
        'Siklu',
        'Siklu', 'EH-[0-9]|BreezeULTRA|MultiHaul', NULL,
        'v2c', 60, FALSE,
        'Siklu E-band / V-band mmWave wireless links. '
        'Uses Siklu enterprise MIB (OID prefix 1.3.6.1.4.1.31926) for RSL, '
        'TSL, SNR, modulation, and link budget metrics. '
        'Primarily used for 60/70/80 GHz multi-gigabit backhaul and last-mile.'
    );

-- ---------------------------------------------------------------------------
-- Part 2: Extend Ubiquiti airOS with RF metrics OIDs
-- ---------------------------------------------------------------------------
-- OID references (airMAX/airOS MIB — ubntAirIf table):
--   ubntAirIfNoiseFloor    1.3.6.1.4.1.41112.1.4.5.1.4  (noise floor dBm)
--   ubntAirIfCcq           1.3.6.1.4.1.41112.1.4.5.1.11 (CCQ %, 0–100)
--   ubntAirIfAirmaxCapTx   1.3.6.1.4.1.41112.1.4.5.1.7  (airtime utilization TX %)
--   ubntAirIfTxRate        1.3.6.1.4.1.41112.1.4.5.1.19 (Tx modulation rate kbps)
--   ubntAirIfRxRate        1.3.6.1.4.1.41112.1.4.5.1.20 (Rx modulation rate kbps)
--   ubntAirIfSnr           1.3.6.1.4.1.41112.1.4.5.1.6  (SNR dB = signal - noise)
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
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.4'  AS oid, 'noise_floor_dbm' AS metric_column, 'airOS Noise Floor (dBm)'     AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, NULL AS transform, 80 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.11',        'ccq_pct',                          'airOS CCQ (%)',              'gauge', FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.7',          'air_util_pct',                     'airOS Airtime Util TX (%)',   'gauge', FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.6',          'snr_db',                           'airOS SNR (dB)',              'gauge', FALSE, NULL, 110 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.19',         'tx_rate_mbps',                     'airOS Tx Rate (kbps÷1000)',   'gauge', FALSE, 'divide1000', 120 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.20',         'rx_rate_mbps',                     'airOS Rx Rate (kbps÷1000)',   'gauge', FALSE, 'divide1000', 130
) o
WHERE p.name = 'Ubiquiti airOS';

-- ---------------------------------------------------------------------------
-- Part 3: Extend MikroTik RouterOS with RF metrics OIDs
-- ---------------------------------------------------------------------------
-- OID references (MikroTik wireless MIB — mtxrWl tables):
--   mtxrWlRtabStrength     1.3.6.1.4.1.14988.1.1.1.2.1.3  (Rx signal dBm — already seeded)
--   mtxrWlRtabTxStrength   1.3.6.1.4.1.14988.1.1.1.2.1.12 (Tx signal dBm)
--   mtxrWlRtabRxStrength   1.3.6.1.4.1.14988.1.1.1.2.1.13 (Rx signal = noise proxy)
--   mtxrWlStatTxCCQ        1.3.6.1.4.1.14988.1.1.1.3.1.9  (Tx CCQ %)
--   mtxrWlRtabCcq          1.3.6.1.4.1.14988.1.1.1.2.1.14 (per-client CCQ)
--   mtxrWlRtabTxRate       1.3.6.1.4.1.14988.1.1.1.2.1.8  (Tx rate bps)
--   mtxrWlRtabRxRate       1.3.6.1.4.1.14988.1.1.1.2.1.9  (Rx rate bps)
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
    SELECT '1.3.6.1.4.1.14988.1.1.1.2.1.13' AS oid, 'noise_floor_dbm' AS metric_column, 'RouterOS Noise Floor proxy (dBm)'  AS label, 'gauge' AS oid_type, FALSE AS is_per_interface, NULL AS transform, 80 AS sort_order UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.1.3.1.9',         'ccq_pct',                           'RouterOS Tx CCQ (%)',              'gauge', FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.1.2.1.8',          'tx_rate_mbps',                      'RouterOS Tx Rate (bps÷1000000)',   'gauge', FALSE, 'divide1000000', 100 UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.1.2.1.9',          'rx_rate_mbps',                      'RouterOS Rx Rate (bps÷1000000)',   'gauge', FALSE, 'divide1000000', 110
) o
WHERE p.name = 'MikroTik RouterOS';

-- ---------------------------------------------------------------------------
-- Part 4: Mimosa Networks OIDs
-- ---------------------------------------------------------------------------
-- Mimosa enterprise MIB prefix: 1.3.6.1.4.1.43356
-- mimosaRadio MIB objects (A/B/C-series):
--   mimosaRxPower          .43356.2.1.2.1.1.1  (Rx signal dBm)
--   mimosaNoise            .43356.2.1.2.1.1.2  (noise floor dBm)
--   mimosaTxPower          .43356.2.1.2.1.1.3  (Tx power dBm)
--   mimosaSNR              .43356.2.1.2.1.1.4  (SNR dB)
--   mimosaAirUtilization   .43356.2.1.2.1.1.7  (airtime utilization %)
--   mimosaModCodDL         .43356.2.1.2.1.1.10 (DL modulation rate Mbps)
--   mimosaModCodUL         .43356.2.1.2.1.1.11 (UL modulation rate Mbps)
--   mimosaCPU              .43356.2.1.1.1.1    (CPU %)
--   mimosaIfInOctets       standard IF-MIB
--   mimosaIfOutOctets      standard IF-MIB
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
    SELECT '1.3.6.1.2.1.2.2.1.10'          AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'              AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',                    'Outbound Octets',             'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                 'if_in_errors',                     'Inbound Errors',              'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                 'if_out_errors',                    'Outbound Errors',             'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.1.1.1',          'cpu_usage',                        'Mimosa CPU (%)',              'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.1',        'signal_strength',                  'Mimosa Rx Signal (dBm)',      'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.3',        'tx_power_dbm',                     'Mimosa Tx Power (dBm) — info only', 'gauge', FALSE, NULL, 65 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.2',        'noise_floor_dbm',                  'Mimosa Noise Floor (dBm)',    'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.4',        'snr_db',                           'Mimosa SNR (dB)',             'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.7',        'air_util_pct',                     'Mimosa Airtime Util (%)',     'gauge',   FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.10',       'tx_rate_mbps',                     'Mimosa DL Modulation Rate (Mbps)', 'gauge', FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.11',       'rx_rate_mbps',                     'Mimosa UL Modulation Rate (Mbps)', 'gauge', FALSE, NULL, 110
) o
WHERE p.name = 'Mimosa Networks';

-- ---------------------------------------------------------------------------
-- Part 5: Tarana Wireless OIDs
-- ---------------------------------------------------------------------------
-- Tarana enterprise MIB prefix: 1.3.6.1.4.1.50536
-- taranaG1 MIB (G1/G1A PTMP):
--   taranaRxRSL            .50536.1.1.1.1  (DL RSSI dBm)
--   taranaNoise            .50536.1.1.1.2  (noise floor dBm)
--   taranaSNR              .50536.1.1.1.3  (SNR dB)
--   taranaGpsSync          .50536.1.1.1.4  (GPS sync: 1=synced)
--   taranaCPU              .50536.1.2.1.1  (CPU %)
--   taranaDLCapacity       .50536.1.1.1.5  (DL capacity Mbps)
--   taranaULCapacity       .50536.1.1.1.6  (UL capacity Mbps)
--   taranaAirUtil          .50536.1.1.1.7  (airtime utilization %)
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
    SELECT '1.3.6.1.2.1.2.2.1.10'          AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.2.1.1',            'cpu_usage',                        'Tarana CPU (%)',               'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.1',            'signal_strength',                  'Tarana DL RSSI (dBm)',         'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.2',            'noise_floor_dbm',                  'Tarana Noise Floor (dBm)',     'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.3',            'snr_db',                           'Tarana SNR (dB)',              'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.4',            'gps_sync_status',                  'Tarana GPS Sync (1=synced)',   'gauge',   FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.7',            'air_util_pct',                     'Tarana Airtime Util (%)',      'gauge',   FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.5',            'tx_rate_mbps',                     'Tarana DL Capacity (Mbps)',   'gauge',   FALSE, NULL, 110 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.6',            'rx_rate_mbps',                     'Tarana UL Capacity (Mbps)',   'gauge',   FALSE, NULL, 120
) o
WHERE p.name = 'Tarana Wireless';

-- ---------------------------------------------------------------------------
-- Part 6: Radwin OIDs
-- ---------------------------------------------------------------------------
-- Radwin enterprise MIB prefix: 1.3.6.1.4.1.4329
-- radwin2000 MIB (2000/5000 PTP/PTMP):
--   rw2000RadioRSL         .4329.5.2.2.1.1.14 (Rx signal level dBm)
--   rw2000RadioTSL         .4329.5.2.2.1.1.15 (Tx signal level dBm)
--   rw2000RadioSNR         .4329.5.2.2.1.1.16 (SNR dB)
--   rw2000RadioNoise       .4329.5.2.2.1.1.17 (noise floor dBm)
--   rw2000RadioMCS         .4329.5.2.2.1.1.20 (modulation index)
--   rw2000AirUtil          .4329.5.2.2.1.1.25 (airtime utilization %)
--   rw2000TxPower          .4329.5.2.2.1.1.13 (Tx power dBm)
--   rw2000CPU              .4329.5.1.1.1.4    (CPU %)
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
    SELECT '1.3.6.1.2.1.2.2.1.10'          AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.1.1.1.4',           'cpu_usage',                        'Radwin CPU (%)',               'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.14',        'signal_strength',                  'Radwin RSL (dBm)',             'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.17',        'noise_floor_dbm',                  'Radwin Noise Floor (dBm)',     'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.16',        'snr_db',                           'Radwin SNR (dB)',              'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.25',        'air_util_pct',                     'Radwin Airtime Util (%)',      'gauge',   FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.15',        'tx_rate_mbps',                     'Radwin TSL (dBm) — TX info',   'gauge',   FALSE, NULL, 100
) o
WHERE p.name = 'Radwin';

-- ---------------------------------------------------------------------------
-- Part 7: Siklu OIDs
-- ---------------------------------------------------------------------------
-- Siklu enterprise MIB prefix: 1.3.6.1.4.1.31926
-- sikluEH MIB (E-band mmWave):
--   sikluRSL               .31926.1.4.1.1.1   (Receive Signal Level dBm)
--   sikluTSL               .31926.1.4.1.1.2   (Transmit Signal Level dBm)
--   sikluSNR               .31926.1.4.1.1.3   (SNR dB)
--   sikluModulation        .31926.1.4.1.1.4   (modulation index)
--   sikluTxCapacity        .31926.1.4.1.1.7   (Tx capacity Mbps)
--   sikluRxCapacity        .31926.1.4.1.1.8   (Rx capacity Mbps)
--   sikluCPU               .31926.1.1.1.1     (CPU %)
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
    SELECT '1.3.6.1.2.1.2.2.1.10'          AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                 'if_in_errors',                     'Inbound Errors',               'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                 'if_out_errors',                    'Outbound Errors',              'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.1.1.1',            'cpu_usage',                        'Siklu CPU (%)',                'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.1',          'signal_strength',                  'Siklu RSL (dBm)',              'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.3',          'snr_db',                           'Siklu SNR (dB)',               'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.7',          'tx_rate_mbps',                     'Siklu Tx Capacity (Mbps)',     'gauge',   FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.8',          'rx_rate_mbps',                     'Siklu Rx Capacity (Mbps)',     'gauge',   FALSE, NULL, 110
) o
WHERE p.name = 'Siklu';
