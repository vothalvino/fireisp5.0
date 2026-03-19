-- Migration: 026_create_snmp_metrics_table
-- Description: Creates the snmp_metrics table for raw SNMP poll data collected
--              every 5 minutes from devices (both client and POP).
--              Retention: 90 days — older rows should be purged or rolled up.

CREATE TABLE IF NOT EXISTS snmp_metrics (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id    BIGINT UNSIGNED NOT NULL,
    metric_name  VARCHAR(100)    NOT NULL COMMENT 'Metric key, e.g. ifInOctets, ifOutOctets, sysUptime',
    metric_oid   VARCHAR(255)    NULL     COMMENT 'SNMP OID that was polled',
    value_numeric DECIMAL(20,4)  NULL     COMMENT 'Numeric metric value',
    value_text   VARCHAR(500)    NULL     COMMENT 'Text metric value (for non-numeric OIDs)',
    polled_at    TIMESTAMP       NOT NULL COMMENT 'Timestamp of the SNMP poll',
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_snmp_metrics_device_metric_time (device_id, metric_name, polled_at),
    KEY idx_snmp_metrics_polled_at (polled_at),
    CONSTRAINT fk_snmp_metrics_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
