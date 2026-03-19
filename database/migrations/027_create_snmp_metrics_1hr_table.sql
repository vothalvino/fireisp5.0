-- Migration: 027_create_snmp_metrics_1hr_table
-- Description: Creates the snmp_metrics_1hr table for hourly aggregates of
--              SNMP metrics. Wide-table design: one row per device / interface
--              per hour with per-metric avg / min / max columns matching the
--              snmp_metrics wide layout.
--              Retention: 1 year -- built from snmp_metrics via scheduled rollup.
--
--              interface_id is NOT NULL DEFAULT '' here so that the unique key
--              (device_id, interface_id, period_start) works correctly in MySQL
--              (NULLs are treated as distinct in UNIQUE indexes).  The rollup
--              procedure maps NULL -> '' via COALESCE.

CREATE TABLE IF NOT EXISTS snmp_metrics_1hr (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        TIMESTAMP       NOT NULL             COMMENT 'Start of the 1-hour aggregation window',
    avg_if_in_octets    DECIMAL(20,4)   NULL     COMMENT 'Average ifInOctets in the period',
    min_if_in_octets    BIGINT          NULL     COMMENT 'Minimum ifInOctets in the period',
    max_if_in_octets    BIGINT          NULL     COMMENT 'Maximum ifInOctets in the period',
    avg_if_out_octets   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutOctets in the period',
    min_if_out_octets   BIGINT          NULL     COMMENT 'Minimum ifOutOctets in the period',
    max_if_out_octets   BIGINT          NULL     COMMENT 'Maximum ifOutOctets in the period',
    avg_if_in_errors    DECIMAL(20,4)   NULL     COMMENT 'Average ifInErrors in the period',
    min_if_in_errors    BIGINT          NULL     COMMENT 'Minimum ifInErrors in the period',
    max_if_in_errors    BIGINT          NULL     COMMENT 'Maximum ifInErrors in the period',
    avg_if_out_errors   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutErrors in the period',
    min_if_out_errors   BIGINT          NULL     COMMENT 'Minimum ifOutErrors in the period',
    max_if_out_errors   BIGINT          NULL     COMMENT 'Maximum ifOutErrors in the period',
    avg_cpu_usage       DECIMAL(5,2)    NULL     COMMENT 'Average CPU utilization percentage',
    min_cpu_usage       SMALLINT        NULL     COMMENT 'Minimum CPU utilization percentage',
    max_cpu_usage       SMALLINT        NULL     COMMENT 'Maximum CPU utilization percentage',
    avg_memory_usage    DECIMAL(5,2)    NULL     COMMENT 'Average memory utilization percentage',
    min_memory_usage    SMALLINT        NULL     COMMENT 'Minimum memory utilization percentage',
    max_memory_usage    SMALLINT        NULL     COMMENT 'Maximum memory utilization percentage',
    avg_signal_strength DECIMAL(7,2)    NULL     COMMENT 'Average signal strength in dBm',
    min_signal_strength INTEGER         NULL     COMMENT 'Minimum signal strength in dBm',
    max_signal_strength INTEGER         NULL     COMMENT 'Maximum signal strength in dBm',
    avg_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Average latency in milliseconds',
    min_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Minimum latency in milliseconds',
    max_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Maximum latency in milliseconds',
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of raw samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1hr_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1hr_period_start (period_start),
    CONSTRAINT fk_snmp_1hr_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
