-- Migration: 028_create_snmp_metrics_1day_table
-- Description: Creates the snmp_metrics_1day table for daily aggregates of
--              SNMP metrics (avg / min / max / sample count).
--              Retention: 3+ years — built from snmp_metrics_1hr via scheduled
--              rollup.

CREATE TABLE IF NOT EXISTS snmp_metrics_1day (
    id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    device_id    BIGINT UNSIGNED  NOT NULL,
    metric_name  VARCHAR(100)     NOT NULL COMMENT 'Metric key matching snmp_metrics.metric_name',
    period_start DATE             NOT NULL COMMENT 'Date of the daily aggregation window',
    avg_value    DECIMAL(20,4)    NULL     COMMENT 'Average of hourly averages in the period',
    min_value    DECIMAL(20,4)    NULL     COMMENT 'Minimum value across hourly windows',
    max_value    DECIMAL(20,4)    NULL     COMMENT 'Maximum value across hourly windows',
    sample_count INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Number of hourly samples aggregated',
    created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1day_device_metric_period (device_id, metric_name, period_start),
    KEY idx_snmp_1day_period_start (period_start),
    CONSTRAINT fk_snmp_1day_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
