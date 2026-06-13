-- =============================================================================
-- Migration 354 — §21.5 Support Channel Configs + §21.6 AI Support Metrics
-- Tables: support_channel_configs, ai_support_metrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS support_channel_configs (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  channel             VARCHAR(30)     NOT NULL,
  is_enabled          TINYINT(1)      NOT NULL DEFAULT 1,
  availability_hours  JSON            NULL,
  handoff_behavior    VARCHAR(50)     NOT NULL DEFAULT 'queue',
  webhook_url         VARCHAR(500)    NULL,
  config_json         JSON            NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_config (organization_id, channel),
  KEY idx_scc_org (organization_id),
  CONSTRAINT fk_scc_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_support_metrics (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  period_date           DATE            NOT NULL,
  resolution_rate       DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  fcr_rate              DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  avg_handle_time_sec   INT             NOT NULL DEFAULT 0,
  escalation_rate       DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  csat_avg              DECIMAL(3,1)    NULL,
  false_positive_rate   DECIMAL(5,2)    NULL,
  avg_latency_ms        INT             NULL,
  total_conversations   INT             NOT NULL DEFAULT 0,
  total_escalations     INT             NOT NULL DEFAULT 0,
  total_ai_cost_usd     DECIMAL(10,4)   NOT NULL DEFAULT 0.0000,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metrics_period (organization_id, period_date),
  KEY idx_asm_org    (organization_id),
  KEY idx_asm_period (period_date),
  CONSTRAINT fk_asm_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
