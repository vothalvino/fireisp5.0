-- Migration: 027_create_snmp_metrics_1hr_table
-- Description: Creates the snmp_metrics_1hr table for hourly aggregates of
--              SNMP metrics (avg / min / max / sample count).
--              Retention: 1 year — built from snmp_metrics via scheduled rollup.

CREATE TABLE IF NOT EXISTS snmp_metrics_1hr (
    id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    device_id    BIGINT UNSIGNED  NOT NULL,
    metric_name  VARCHAR(100)     NOT NULL COMMENT 'Metric key matching snmp_metrics.metric_name',
    period_start TIMESTAMP        NOT NULL COMMENT 'Start of the 1-hour aggregation window',
    avg_value    DECIMAL(20,4)    NULL     COMMENT 'Average of numeric values in the period',
    min_value    DECIMAL(20,4)    NULL     COMMENT 'Minimum numeric value in the period',
    max_value    DECIMAL(20,4)    NULL     COMMENT 'Maximum numeric value in the period',
    sample_count INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Number of raw samples aggregated',
    created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1hr_device_metric_period (device_id, metric_name, period_start),
    KEY idx_snmp_1hr_period_start (period_start),
    CONSTRAINT fk_snmp_1hr_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
