-- =============================================================================
-- Migration 258: §6.4 Polling Engine — tables and scheduled tasks
-- =============================================================================
-- Implements isp-platform-features.md §6.4 "Polling Engine":
--   poller_nodes                  — registry of dedicated SNMP poller nodes
--   device_polling_configs        — per-device or per-type polling overrides
--   poller_performance_snapshots  — time-series store for poller health metrics
--
-- Also seeds two scheduled tasks:
--   snmp_adaptive_poll_check     — */1 * * * * adaptive polling frequency check
--   poller_performance_snapshot  — */5 * * * * record performance metrics
--
-- Uses INSERT ... SELECT ... FROM DUAL WHERE NOT EXISTS for task idempotency.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: poller_nodes
-- Registry of dedicated SNMP poller nodes (firerelay or standalone).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poller_nodes (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  node_identifier        VARCHAR(64)     NOT NULL COMMENT 'Matches firerelay_nodes.id if linked',
  name                   VARCHAR(255)    NOT NULL,
  status                 ENUM('active','draining','maintenance','offline') NOT NULL DEFAULT 'active',
  api_url                VARCHAR(512)    NULL,
  max_concurrent_polls   INT UNSIGNED    NOT NULL DEFAULT 10,
  current_queue_depth    INT UNSIGNED    NOT NULL DEFAULT 0,
  total_polls_today      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_polls_today     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  avg_poll_duration_ms   INT UNSIGNED    NULL,
  last_heartbeat_at      DATETIME        NULL,
  created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_poller_nodes_identifier (node_identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_polling_configs
-- Per-device or per-type polling overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_polling_configs (
  id                         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  organization_id            BIGINT UNSIGNED  NULL,
  device_id                  BIGINT UNSIGNED  NULL COMMENT 'NULL = applies to all devices of this type',
  device_type                VARCHAR(50)      NULL COMMENT 'Match devices.type; only used when device_id IS NULL',
  poller_node_id             BIGINT UNSIGNED  NULL,
  poll_interval_sec          INT UNSIGNED     NOT NULL DEFAULT 300,
  bulk_get_enabled           TINYINT(1)       NOT NULL DEFAULT 1 COMMENT 'Use SNMP GETBULK instead of GET',
  max_repetitions            SMALLINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'GETBULK MaxRepetitions',
  timeout_ms                 INT UNSIGNED     NOT NULL DEFAULT 5000,
  retries                    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  failover_node_id           BIGINT UNSIGNED  NULL,
  adaptive_polling_enabled   TINYINT(1)       NOT NULL DEFAULT 0 COMMENT 'Increase frequency during incidents',
  adaptive_min_interval_sec  INT UNSIGNED     NOT NULL DEFAULT 60,
  is_enabled                 TINYINT(1)       NOT NULL DEFAULT 1,
  deleted_at                 DATETIME         NULL,
  created_at                 DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dpc_org_device (organization_id, device_id),
  INDEX idx_dpc_organization_id (organization_id),
  INDEX idx_dpc_device_id (device_id),
  CONSTRAINT fk_dpc_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_dpc_device       FOREIGN KEY (device_id)       REFERENCES devices       (id) ON DELETE CASCADE,
  CONSTRAINT fk_dpc_poller_node  FOREIGN KEY (poller_node_id)  REFERENCES poller_nodes  (id) ON DELETE SET NULL,
  CONSTRAINT fk_dpc_failover     FOREIGN KEY (failover_node_id) REFERENCES poller_nodes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: poller_performance_snapshots
-- Append-only time-series store for poller node health metrics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poller_performance_snapshots (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  poller_node_id       BIGINT UNSIGNED NULL,
  snapshot_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  devices_polled       INT UNSIGNED    NOT NULL DEFAULT 0,
  devices_failed       INT UNSIGNED    NOT NULL DEFAULT 0,
  avg_poll_duration_ms INT UNSIGNED    NULL,
  max_poll_duration_ms INT UNSIGNED    NULL,
  queue_depth          INT UNSIGNED    NOT NULL DEFAULT 0,
  timeout_rate_pct     DECIMAL(5,2)    NULL COMMENT 'Failed / total * 100',
  PRIMARY KEY (id),
  INDEX idx_pps_node_snapshot (poller_node_id, snapshot_at),
  CONSTRAINT fk_pps_node FOREIGN KEY (poller_node_id) REFERENCES poller_nodes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheduled task: snmp_adaptive_poll_check
-- Checks for active incidents and switches affected devices to adaptive
-- polling frequency every minute.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'snmp_adaptive_poll_check',
    'snmp_poll',
    'pollerEngine.adaptivePollCheck',
    'Check for active incidents and switch affected devices to adaptive polling frequency',
    '*/1 * * * *',
    1,
    'high'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'snmp_adaptive_poll_check' AND organization_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Scheduled task: poller_performance_snapshot
-- Records poller node performance metrics every 5 minutes.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'poller_performance_snapshot',
    'snmp_poll',
    'pollerEngine.recordPerformanceSnapshot',
    'Record poller node performance metrics snapshot',
    '*/5 * * * *',
    1,
    'low'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'poller_performance_snapshot' AND organization_id IS NULL
);

-- END OF MIGRATION 258
