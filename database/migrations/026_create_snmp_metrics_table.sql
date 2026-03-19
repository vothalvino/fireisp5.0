-- Migration: 026_create_snmp_metrics_table
-- Description: Creates the snmp_metrics table for raw SNMP poll data collected
--              every 5 minutes from devices (both client and POP).
--
--              Wide-table design: one row per device (+ optional interface) per
--              poll instead of one row per metric — 8× fewer rows at 6 000-device
--              scale (~1.73 M rows/day vs ~13.8 M with the narrow EAV approach).
--
--              No FK on device_id: removed to avoid write overhead on the hot
--              insert path (~10 000 inserts/min at target scale).
--
--              Partitioned by month (RANGE on UNIX_TIMESTAMP(polled_at)) so
--              90-day retention is handled by instant DROP PARTITION instead of
--              slow batch-DELETE loops.
--
--              Retention: 90 days — managed via snmp_maintain_partitions().

CREATE TABLE IF NOT EXISTS snmp_metrics (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id       BIGINT UNSIGNED NOT NULL,
    interface_id    VARCHAR(64)     NULL       COMMENT 'SNMP ifIndex or ifDescr for interface-level metrics',
    if_in_octets    BIGINT          NULL       COMMENT 'ifInOctets — bytes received',
    if_out_octets   BIGINT          NULL       COMMENT 'ifOutOctets — bytes transmitted',
    if_in_errors    BIGINT          NULL       COMMENT 'ifInErrors — inbound errors',
    if_out_errors   BIGINT          NULL       COMMENT 'ifOutErrors — outbound errors',
    cpu_usage       SMALLINT        NULL       COMMENT 'CPU utilization percentage',
    memory_usage    SMALLINT        NULL       COMMENT 'Memory utilization percentage',
    signal_strength INTEGER         NULL       COMMENT 'Wireless signal strength in dBm',
    latency_ms      DECIMAL(10,2)   NULL       COMMENT 'ICMP ping latency in milliseconds',
    polled_at       TIMESTAMP       NOT NULL   COMMENT 'Timestamp of the SNMP poll',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, polled_at),
    KEY idx_snmp_metrics_device_time (device_id, polled_at),
    KEY idx_snmp_metrics_device_iface_time (device_id, interface_id, polled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (UNIX_TIMESTAMP(polled_at)) (
    PARTITION p2026_01 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p2026_02 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (UNIX_TIMESTAMP('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);
