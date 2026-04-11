-- Migration: 117_create_network_health_snapshots_table
-- Description: Aggregated daily device uptime and link utilization snapshots.
--              Populated by the monitoring subsystem for trending, SLA
--              compliance reporting, and capacity planning dashboards.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS network_health_snapshots (
    id                        BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    device_id                 BIGINT UNSIGNED   NULL                    COMMENT 'Device this snapshot is for; NULL if link-only snapshot',
    network_link_id           BIGINT UNSIGNED   NULL                    COMMENT 'Network link this snapshot is for; NULL if device-only snapshot',
    snapshot_date             DATE              NOT NULL                COMMENT 'Calendar date this snapshot covers (one row per day)',
    uptime_pct                DECIMAL(5, 2)     NULL                    COMMENT 'Device/link uptime percentage for the day (0.00–100.00)',
    avg_latency_ms            DECIMAL(8, 2)     NULL                    COMMENT 'Average round-trip latency in milliseconds over the day',
    max_latency_ms            DECIMAL(8, 2)     NULL                    COMMENT 'Peak round-trip latency in milliseconds over the day',
    avg_throughput_in_mbps    DECIMAL(10, 3)    NULL                    COMMENT 'Average inbound throughput in Mbps over the day',
    avg_throughput_out_mbps   DECIMAL(10, 3)    NULL                    COMMENT 'Average outbound throughput in Mbps over the day',
    peak_throughput_in_mbps   DECIMAL(10, 3)    NULL                    COMMENT 'Peak inbound throughput in Mbps observed during the day',
    peak_throughput_out_mbps  DECIMAL(10, 3)    NULL                    COMMENT 'Peak outbound throughput in Mbps observed during the day',
    packet_loss_pct           DECIMAL(5, 2)     NULL                    COMMENT 'Average packet loss percentage for the day (0.00–100.00)',
    total_downtime_minutes    INT UNSIGNED      NOT NULL DEFAULT 0      COMMENT 'Total minutes of detected downtime during the day',
    created_at                TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_network_health_device_date (device_id, snapshot_date),
    KEY idx_network_health_link_date (network_link_id, snapshot_date),
    KEY idx_network_health_snapshot_date (snapshot_date),
    CONSTRAINT fk_network_health_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_network_health_link FOREIGN KEY (network_link_id)
        REFERENCES network_links (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
