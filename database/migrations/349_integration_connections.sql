-- =============================================================================
-- Migration 349 — §20.2 Third-Party Integrations: connection instances + logs
-- Tables: integration_connections, integration_sync_logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS integration_connections (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  provider_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(255)    NOT NULL COMMENT 'Human label for this connection instance',
  credentials_enc     TEXT            NULL     COMMENT 'AES-256-GCM encrypted JSON; NEVER returned in plaintext',
  config_json         JSON            NULL     COMMENT 'Non-secret config: base URL overrides, field mappings, etc.',
  status              ENUM('active','error','disabled','pending') NOT NULL DEFAULT 'pending',
  last_synced_at      DATETIME        NULL,
  last_error          TEXT            NULL,
  is_enabled          TINYINT(1)      NOT NULL DEFAULT 1,
  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ic_org      (organization_id),
  KEY idx_ic_provider (provider_id),
  CONSTRAINT fk_ic_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_ic_provider     FOREIGN KEY (provider_id)     REFERENCES integration_providers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  connection_id   BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  direction       ENUM('inbound','outbound','bidirectional') NOT NULL DEFAULT 'outbound',
  status          ENUM('queued','running','success','error','stubbed') NOT NULL DEFAULT 'queued',
  records_in      INT UNSIGNED    NULL DEFAULT 0,
  records_out     INT UNSIGNED    NULL DEFAULT 0,
  records_error   INT UNSIGNED    NULL DEFAULT 0,
  error_message   TEXT            NULL,
  started_at      DATETIME        NULL,
  completed_at    DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_isl_connection   (connection_id),
  KEY idx_isl_org          (organization_id),
  KEY idx_isl_created      (created_at),
  CONSTRAINT fk_isl_connection   FOREIGN KEY (connection_id)   REFERENCES integration_connections (id) ON DELETE CASCADE,
  CONSTRAINT fk_isl_org          FOREIGN KEY (organization_id) REFERENCES organizations           (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
