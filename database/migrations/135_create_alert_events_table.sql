-- =============================================================================
-- Migration 135 — Alert Events
-- =============================================================================
-- Log of triggered alert events for history and acknowledgement tracking.
-- =============================================================================

CREATE TABLE IF NOT EXISTS alert_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_rule_id   BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  device_id       BIGINT UNSIGNED NULL,
  metric          VARCHAR(50)     NOT NULL,
  current_value   DECIMAL(12,4)   NULL,
  threshold_value DECIMAL(12,4)   NULL,
  status          ENUM('triggered','acknowledged','resolved') NOT NULL DEFAULT 'triggered',
  acknowledged_by BIGINT UNSIGNED NULL,
  acknowledged_at TIMESTAMP       NULL,
  resolved_at     TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_alert_events_org     (organization_id, created_at),
  INDEX idx_alert_events_rule    (alert_rule_id),
  INDEX idx_alert_events_status  (organization_id, status),
  CONSTRAINT fk_alert_events_rule FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_events_org  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
