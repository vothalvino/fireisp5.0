-- =============================================================================
-- FireISP 5.0 — Migration 130: Create firerelay_nodes table
-- =============================================================================
-- Registry of all nodes in a FireRelay cluster.  Only used when
-- FIRERELAY_MODE = master.  Workers and standalone installs ignore this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS firerelay_nodes (
  id              VARCHAR(64)   NOT NULL COMMENT 'Unique node identifier (e.g. node2)',
  name            VARCHAR(255)  NOT NULL DEFAULT '' COMMENT 'Human-readable name',
  api_url         VARCHAR(512)  NOT NULL COMMENT 'Base URL of the node API',
  status          ENUM('active','draining','maintenance','offline')
                                NOT NULL DEFAULT 'active'
                                COMMENT 'Current lifecycle state',
  client_count    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Last reported client count',
  device_count    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Last reported device count',
  cpu_percent     DECIMAL(5,2)  NULL COMMENT 'Last reported CPU usage %',
  memory_percent  DECIMAL(5,2)  NULL COMMENT 'Last reported memory usage %',
  disk_percent    DECIMAL(5,2)  NULL COMMENT 'Last reported disk usage %',
  db_size_mb      INT UNSIGNED  NULL COMMENT 'Last reported database size in MB',
  uptime_seconds  BIGINT UNSIGNED NULL COMMENT 'Last reported uptime in seconds',
  last_seen_at    DATETIME      NULL COMMENT 'Timestamp of last successful health check',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_firerelay_nodes_api_url (api_url),
  KEY idx_firerelay_nodes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
