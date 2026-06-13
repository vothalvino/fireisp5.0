-- =============================================================================
-- Migration 352 — §21.3 AI Diagnostics: diagnostic run history
-- Table: ai_diagnostic_runs
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_diagnostic_runs (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  client_id           BIGINT UNSIGNED NOT NULL,
  conversation_id     BIGINT UNSIGNED NULL,
  access_type         ENUM('fiber','wireless','unknown') NOT NULL DEFAULT 'unknown',
  symptom             VARCHAR(100)    NOT NULL,
  checks_run          JSON            NULL,
  cause               VARCHAR(500)    NULL,
  recommendation      TEXT            NULL,
  auto_fix_available  TINYINT(1)      NOT NULL DEFAULT 0,
  confidence          DECIMAL(4,3)    NULL,
  escalate            TINYINT(1)      NOT NULL DEFAULT 0,
  escalation_reason   VARCHAR(500)    NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adr_org          (organization_id),
  KEY idx_adr_client       (client_id),
  KEY idx_adr_conversation (conversation_id),
  CONSTRAINT fk_adr_org          FOREIGN KEY (organization_id) REFERENCES organizations         (id) ON DELETE CASCADE,
  CONSTRAINT fk_adr_client       FOREIGN KEY (client_id)       REFERENCES clients               (id) ON DELETE CASCADE,
  CONSTRAINT fk_adr_conversation FOREIGN KEY (conversation_id) REFERENCES support_conversations (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
