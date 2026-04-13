-- Migration: 151_create_firerelay_nodes_table
-- Description: Creates the firerelay_nodes table on the master node to track
--              all worker nodes in the FireRelay cluster.
--
-- This table is only used when FIRERELAY_MODE=master.  Worker nodes do not
-- need it (they report health via GET /api/firerelay/health).

CREATE TABLE IF NOT EXISTS firerelay_nodes (
    id              VARCHAR(64)  NOT NULL COMMENT 'Unique node identifier (e.g. node2)',
    name            VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Human-readable name',
    api_url         VARCHAR(512) NOT NULL COMMENT 'Base URL of the node API',
    status          ENUM('active','draining','maintenance','offline')
                    NOT NULL DEFAULT 'active'
                    COMMENT 'Current lifecycle state',
    client_count    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Last reported client count',
    device_count    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Last reported device count',
    cpu_percent     DECIMAL(5,2) DEFAULT NULL COMMENT 'Last reported CPU usage %',
    memory_percent  DECIMAL(5,2) DEFAULT NULL COMMENT 'Last reported memory usage %',
    disk_percent    DECIMAL(5,2) DEFAULT NULL COMMENT 'Last reported disk usage %',
    db_size_mb      INT UNSIGNED DEFAULT NULL COMMENT 'Last reported database size in MB',
    uptime_seconds  INT UNSIGNED DEFAULT NULL COMMENT 'Last reported uptime in seconds',
    last_seen_at    DATETIME     DEFAULT NULL COMMENT 'Timestamp of last successful health check',
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_firerelay_nodes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
