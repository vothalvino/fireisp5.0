-- =============================================================================
-- Migration 293: Bandwidth Test Servers and Subscriber Speed Test Jobs — §10.4
-- =============================================================================
-- Tables created:
--   bandwidth_test_servers    — iperf3/speedtest node registry
--   subscriber_speed_test_jobs — scheduled/on-demand per-subscriber speed tests
-- Scheduled task seeded:
--   subscriber_speed_test_run — every 5 min, dispatches queued speed test jobs
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

-- ---------------------------------------------------------------------------
-- 1. bandwidth_test_servers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bandwidth_test_servers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NULL,
  host            VARCHAR(255) NOT NULL COMMENT 'IP address or hostname of the test server',
  port            SMALLINT UNSIGNED NOT NULL DEFAULT 5201
                    COMMENT 'TCP/UDP port (iperf3 default: 5201)',
  protocol        ENUM('iperf3','speedtest_cli','custom') NOT NULL DEFAULT 'iperf3',
  region          VARCHAR(100) NULL COMMENT 'Geographic region or datacenter name',
  site_id         BIGINT UNSIGNED NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  auth_token      VARCHAR(255) NULL COMMENT 'Optional API token for private test servers',
  max_bandwidth_mbps INT UNSIGNED NULL COMMENT 'Capacity cap to prevent oversubscription',
  last_tested_at  DATETIME NULL,
  last_rtt_ms     DECIMAL(8,3) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_bts_org (organization_id),
  KEY idx_bts_site (site_id),
  KEY idx_bts_active (is_active),
  KEY idx_bts_deleted (deleted_at),
  CONSTRAINT fk_bts_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_bts_site FOREIGN KEY (site_id)
    REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. subscriber_speed_test_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_speed_test_jobs (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NULL,
  contract_id           BIGINT UNSIGNED NOT NULL,
  test_server_id        BIGINT UNSIGNED NULL,
  requested_by          ENUM('admin','scheduler','client_portal','api') NOT NULL DEFAULT 'admin',
  scheduled_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at            DATETIME NULL,
  completed_at          DATETIME NULL,
  status                ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  download_mbps         DECIMAL(10,3) NULL COMMENT 'Measured download speed',
  upload_mbps           DECIMAL(10,3) NULL COMMENT 'Measured upload speed',
  latency_ms            DECIMAL(8,3) NULL,
  jitter_ms             DECIMAL(8,3) NULL,
  packet_loss_pct       DECIMAL(5,2) NULL,
  protocol              ENUM('iperf3','speedtest_cli','custom') NULL,
  error_message         TEXT NULL,
  raw_result            JSON NULL COMMENT 'Full JSON result from test tool',
  notes                 TEXT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sstj_contract (contract_id),
  KEY idx_sstj_server (test_server_id),
  KEY idx_sstj_status (status),
  KEY idx_sstj_org (organization_id),
  KEY idx_sstj_scheduled (scheduled_at),
  CONSTRAINT fk_sstj_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sstj_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sstj_server FOREIGN KEY (test_server_id)
    REFERENCES bandwidth_test_servers (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Scheduled task: subscriber_speed_test_run
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (name, task_type, cron_expression, is_active, priority, description, created_at, updated_at)
SELECT 'subscriber_speed_test_run', 'other', '*/5 * * * *', 1, 'low',
  'Dispatch queued subscriber speed test jobs and record results',
  NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE name = 'subscriber_speed_test_run'
);

SET FOREIGN_KEY_CHECKS=1;
