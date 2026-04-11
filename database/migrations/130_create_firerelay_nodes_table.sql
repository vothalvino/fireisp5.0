-- =============================================================================
-- FireISP 5.0 — Migration 130: Create firerelay_nodes table
-- =============================================================================
-- Registry of all nodes in a FireRelay cluster.  Only used when
-- FIRERELAY_MODE = master.  Workers and standalone installs ignore this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS firerelay_nodes (
  id              VARCHAR(64)   NOT NULL,
  name            VARCHAR(255)  NOT NULL DEFAULT '',
  api_url         VARCHAR(512)  NOT NULL,
  status          ENUM('active','draining','maintenance','offline')
                                NOT NULL DEFAULT 'active',
  client_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  device_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  cpu_percent     DECIMAL(5,2)  NULL,
  memory_percent  DECIMAL(5,2)  NULL,
  disk_percent    DECIMAL(5,2)  NULL,
  db_size_mb      INT UNSIGNED  NULL,
  uptime_seconds  BIGINT UNSIGNED NULL,
  last_seen_at    DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_firerelay_nodes_api_url (api_url),
  KEY idx_firerelay_nodes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
