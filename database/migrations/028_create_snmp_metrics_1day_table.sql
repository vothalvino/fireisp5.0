-- Migration: 028_create_snmp_metrics_1day_table
-- Description: Creates the snmp_metrics_1day table for daily aggregates of
--              SNMP metrics. Wide-table design: one row per device / interface
--              per day with per-metric avg / min / max columns matching the
--              snmp_metrics wide layout.
--              Retention: 3+ years -- built from snmp_metrics_1hr via scheduled
--              rollup.
--
--              interface_id is NOT NULL DEFAULT '' to enforce the unique key
--              correctly (see snmp_metrics_1hr notes in migration 027).

CREATE TABLE IF NOT EXISTS snmp_metrics_1day (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        DATE            NOT NULL             COMMENT 'Date of the daily aggregation window',
    avg_if_in_octets    DECIMAL(20,4)   NULL     COMMENT 'Average ifInOctets across hourly windows',
    min_if_in_octets    BIGINT          NULL     COMMENT 'Minimum ifInOctets across hourly windows',
    max_if_in_octets    BIGINT          NULL     COMMENT 'Maximum ifInOctets across hourly windows',
    avg_if_out_octets   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutOctets across hourly windows',
    min_if_out_octets   BIGINT          NULL     COMMENT 'Minimum ifOutOctets across hourly windows',
    max_if_out_octets   BIGINT          NULL     COMMENT 'Maximum ifOutOctets across hourly windows',
    avg_if_in_errors    DECIMAL(20,4)   NULL     COMMENT 'Average ifInErrors across hourly windows',
    min_if_in_errors    BIGINT          NULL     COMMENT 'Minimum ifInErrors across hourly windows',
    max_if_in_errors    BIGINT          NULL     COMMENT 'Maximum ifInErrors across hourly windows',
    avg_if_out_errors   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutErrors across hourly windows',
    min_if_out_errors   BIGINT          NULL     COMMENT 'Minimum ifOutErrors across hourly windows',
    max_if_out_errors   BIGINT          NULL     COMMENT 'Maximum ifOutErrors across hourly windows',
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
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of hourly samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1day_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1day_period_start (period_start),
    CONSTRAINT fk_snmp_1day_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
