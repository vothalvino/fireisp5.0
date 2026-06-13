-- =============================================================================
-- Migration 355 — §21.7 NOC AI Insights
-- Table: noc_ai_insights
-- =============================================================================

CREATE TABLE IF NOT EXISTS noc_ai_insights (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  insight_type          ENUM('alert_explanation','capacity_warning','interference_detection','alignment_drift','shift_summary','runbook_suggestion') NOT NULL,
  alert_id              BIGINT UNSIGNED NULL,
  device_id             BIGINT UNSIGNED NULL,
  affected_subscribers  INT             NOT NULL DEFAULT 0,
  summary               TEXT            NOT NULL,
  recommendation        TEXT            NULL,
  confidence            DECIMAL(4,3)    NULL,
  provider_id           BIGINT UNSIGNED NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_nai_org      (organization_id),
  KEY idx_nai_type     (insight_type),
  KEY idx_nai_created  (created_at),
  CONSTRAINT fk_nai_org      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_nai_provider FOREIGN KEY (provider_id)     REFERENCES ai_providers  (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
