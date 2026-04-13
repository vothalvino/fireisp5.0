-- =============================================================================
-- Migration 134 — Alert Rules
-- =============================================================================
-- Configurable monitoring alert rules per organization.
-- =============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(200)    NOT NULL,
  description     TEXT            NULL,
  metric          VARCHAR(50)     NOT NULL COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime',
  operator        VARCHAR(5)      NOT NULL DEFAULT '>' COMMENT '>, >=, <, <=, ==',
  threshold       DECIMAL(10,2)   NOT NULL,
  device_id       BIGINT UNSIGNED NULL COMMENT 'NULL = all devices',
  duration_minutes INT UNSIGNED   NOT NULL DEFAULT 5 COMMENT 'Evaluation window in minutes',
  severity        ENUM('info','warning','major','critical') NOT NULL DEFAULT 'major',
  auto_create_outage BOOLEAN      NOT NULL DEFAULT FALSE,
  notification_channels JSON      NULL COMMENT '["email","sms","sse","webhook"]',
  is_enabled      BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_alert_rules_org      (organization_id),
  INDEX idx_alert_rules_enabled  (organization_id, is_enabled),
  CONSTRAINT fk_alert_rules_org  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
