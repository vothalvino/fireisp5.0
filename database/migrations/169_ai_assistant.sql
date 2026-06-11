-- =============================================================================
-- Migration 169 — AI Reply Assistant (P1: data layer)
-- =============================================================================
-- Adds all database objects required for the AI Reply Assistant feature:
--   • ai_providers   — pluggable LLM provider registry (per org)
--   • ai_policies    — per-org on/off switch, channel toggles, mode, tone
--   • ai_phrase_library  — curated reply phrases per locale/category
--   • ai_forbidden_terms — output validator: reject drafts containing these
--   • ai_reply_logs  — immutable audit trail for every AI draft/send action
--   • contract_topology_paths — topology-path cache (CPE → edge)
--
-- Light schema additions:
--   • network_links.medium  ENUM('fiber','wireless','copper')
--   • network_links.role    ENUM('access','distribution','backhaul','core')
--   • devices.role          ENUM('access','distribution','backhaul','core')
--   • organization_quotas.max_ai_tokens_month  (INT, NULL = unlimited)
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 1. ai_providers — LLM provider registry (must exist before ai_policies)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_providers (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    name                VARCHAR(100)     NOT NULL COMMENT 'Admin-visible display name, e.g. "OpenAI prod"',
    kind                ENUM('openai','azure_openai','anthropic','gemini','ollama','custom')
                                         NOT NULL DEFAULT 'openai',
    model               VARCHAR(100)     NOT NULL COMMENT 'e.g. gpt-4o-mini, claude-3-5-sonnet, llama3.1:8b',
    endpoint_url        VARCHAR(500)     NULL     COMMENT 'Required for azure_openai, ollama, and custom kinds',
    api_key_encrypted   TEXT             NULL     COMMENT 'AES-256-GCM encrypted API key (see src/utils/encryption.js)',
    extra_config        JSON             NULL     COMMENT 'Deployment ID, region, custom headers, etc.',
    temperature         DECIMAL(3,2)     NOT NULL DEFAULT 0.20,
    max_tokens          INT UNSIGNED     NOT NULL DEFAULT 800,
    timeout_ms          INT UNSIGNED     NOT NULL DEFAULT 20000,
    enabled             TINYINT(1)       NOT NULL DEFAULT 1,
    priority            INT              NOT NULL DEFAULT 100 COMMENT 'Lower value = higher priority in fallback chain',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_providers_org           (organization_id),
    KEY idx_ai_providers_org_enabled   (organization_id, enabled),
    KEY idx_ai_providers_org_priority  (organization_id, priority),
    KEY idx_ai_providers_deleted_at    (deleted_at),

    CONSTRAINT fk_ai_providers_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. ai_policies — per-org on/off switch + mode configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_policies (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED  NOT NULL,
    enabled                 TINYINT(1)       NOT NULL DEFAULT 0
                                              COMMENT 'Master on/off switch for the AI assistant',
    enabled_channels        JSON             NOT NULL
                                              DEFAULT (JSON_OBJECT('portal', FALSE, 'email', FALSE, 'whatsapp', FALSE, 'sms', FALSE))
                                              COMMENT '{"portal":true,"email":true,"whatsapp":false,"sms":false}',
    mode                    ENUM('draft_only','suggest','auto_send')
                                             NOT NULL DEFAULT 'draft_only',
    auto_send_confidence    DECIMAL(3,2)     NOT NULL DEFAULT 0.85
                                              COMMENT '0.00–1.00 confidence threshold for auto_send mode',
    default_locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX',
    tone                    ENUM('formal','neutral','friendly')
                                             NOT NULL DEFAULT 'formal',
    redact_pii_before_llm   TINYINT(1)       NOT NULL DEFAULT 1
                                              COMMENT 'Strip IP/MAC/phone/email/address before sending to LLM',
    active_provider_id      BIGINT UNSIGNED  NULL
                                              COMMENT 'Currently selected ai_providers.id',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_policies_org      (organization_id),
    KEY idx_ai_policies_org_enabled    (organization_id, enabled),

    CONSTRAINT fk_ai_policies_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_policies_provider
        FOREIGN KEY (active_provider_id) REFERENCES ai_providers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. ai_phrase_library — curated on-brand reply phrases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_phrase_library (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NOT NULL,
    locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX'
                                      COMMENT 'BCP-47 locale tag',
    category        VARCHAR(50)      NOT NULL
                                      COMMENT 'e.g. greeting, apology, outage_update, escalation, closing',
    text            TEXT             NOT NULL COMMENT 'Phrase text the LLM must use or draw from',
    is_required     TINYINT(1)       NOT NULL DEFAULT 0
                                      COMMENT 'If 1, draft is rejected when phrase is absent',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_phrases_org             (organization_id),
    KEY idx_ai_phrases_org_locale_cat  (organization_id, locale, category),
    KEY idx_ai_phrases_deleted_at      (deleted_at),

    CONSTRAINT fk_ai_phrases_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. ai_forbidden_terms — output-level content guardrails
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_forbidden_terms (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NOT NULL,
    locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX',
    term            VARCHAR(255)     NOT NULL COMMENT 'Term that must never appear in a draft',
    replacement     VARCHAR(255)     NULL     COMMENT 'Optional safe substitute the validator may suggest',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_forbidden_org           (organization_id),
    KEY idx_ai_forbidden_org_locale    (organization_id, locale),
    KEY idx_ai_forbidden_deleted_at    (deleted_at),

    CONSTRAINT fk_ai_forbidden_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. ai_reply_logs — immutable audit trail for every AI action
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_reply_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    ticket_id           BIGINT UNSIGNED  NOT NULL,
    provider_id         BIGINT UNSIGNED  NULL     COMMENT 'ai_providers.id that produced this draft',
    classification      VARCHAR(50)      NULL     COMMENT 'Category assigned by classify step',
    confidence          DECIMAL(5,4)     NULL     COMMENT '0.0000–1.0000 LLM-reported confidence score',
    context_snapshot    JSON             NULL     COMMENT 'topology + health snapshot sent to LLM (no PII after redact)',
    prompt_hash         VARCHAR(64)      NULL     COMMENT 'SHA-256 of the rendered system prompt (for dedup / audit)',
    draft_text          TEXT             NULL     COMMENT 'Raw draft returned by LLM',
    final_text          TEXT             NULL     COMMENT 'Text actually sent to the client (may differ if edited)',
    action              ENUM('proposed','edited','sent','auto_sent','discarded','failed')
                                         NOT NULL DEFAULT 'proposed',
    reviewer_user_id    BIGINT UNSIGNED  NULL     COMMENT 'Staff user who sent/edited/discarded',
    prompt_tokens       INT UNSIGNED     NULL,
    completion_tokens   INT UNSIGNED     NULL,
    cost_usd            DECIMAL(10,6)    NULL,
    duration_ms         INT UNSIGNED     NULL,
    error               TEXT             NULL     COMMENT 'Error detail when action = failed',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ai_reply_logs_org           (organization_id),
    KEY idx_ai_reply_logs_org_ticket    (organization_id, ticket_id),
    KEY idx_ai_reply_logs_ticket        (ticket_id),
    KEY idx_ai_reply_logs_provider      (provider_id),
    KEY idx_ai_reply_logs_action        (action),
    KEY idx_ai_reply_logs_created_at    (created_at),

    CONSTRAINT fk_ai_reply_logs_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_provider
        FOREIGN KEY (provider_id) REFERENCES ai_providers (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_reviewer
        FOREIGN KEY (reviewer_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. contract_topology_paths — topology path cache (CPE → edge)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_topology_paths (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id BIGINT UNSIGNED  NOT NULL,
    path        JSON             NOT NULL
                                  COMMENT 'Ordered [{device_id,role,link_id,medium}] CPE→edge',
    computed_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  COMMENT 'Timestamp of last computation; used for cache invalidation',

    PRIMARY KEY (id),
    UNIQUE KEY uq_contract_topology_paths_contract (contract_id),
    KEY idx_contract_topology_paths_computed_at (computed_at),

    CONSTRAINT fk_contract_topology_paths_contract
        FOREIGN KEY (contract_id) REFERENCES contracts (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7. network_links — add medium + role columns for topology traversal
--    (guarded so the migration is safely re-runnable after a partial failure)
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_169_add_network_links_columns;
DELIMITER //
CREATE PROCEDURE migration_169_add_network_links_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'network_links'
      AND COLUMN_NAME  = 'medium'
  ) THEN
    ALTER TABLE network_links
        ADD COLUMN medium
            ENUM('fiber','wireless','copper') NULL
            COMMENT 'Physical medium of the link'
            AFTER capacity_mbps;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'network_links'
      AND COLUMN_NAME  = 'role'
  ) THEN
    ALTER TABLE network_links
        ADD COLUMN role
            ENUM('access','distribution','backhaul','core') NULL
            COMMENT 'Logical role in the network topology'
            AFTER medium;
  END IF;
END //
DELIMITER ;
CALL migration_169_add_network_links_columns();
DROP PROCEDURE IF EXISTS migration_169_add_network_links_columns;

-- ---------------------------------------------------------------------------
-- 8. devices — add role column for topology traversal
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_169_add_devices_role;
DELIMITER //
CREATE PROCEDURE migration_169_add_devices_role()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'role'
  ) THEN
    ALTER TABLE devices
        ADD COLUMN role
            ENUM('access','distribution','backhaul','core') NULL
            COMMENT 'Logical role of this device in the network topology'
            AFTER firerelay_node_id;
  END IF;
END //
DELIMITER ;
CALL migration_169_add_devices_role();
DROP PROCEDURE IF EXISTS migration_169_add_devices_role;

-- ---------------------------------------------------------------------------
-- 9. organization_quotas — add ai_tokens_month counter
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS migration_169_add_org_quotas_ai_tokens;
DELIMITER //
CREATE PROCEDURE migration_169_add_org_quotas_ai_tokens()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'max_ai_tokens_month'
  ) THEN
    ALTER TABLE organization_quotas
        ADD COLUMN max_ai_tokens_month
            INT UNSIGNED NULL
            COMMENT 'Max AI tokens consumed per calendar month; NULL = unlimited'
            AFTER max_scheduled_tasks;
  END IF;
END //
DELIMITER ;
CALL migration_169_add_org_quotas_ai_tokens();
DROP PROCEDURE IF EXISTS migration_169_add_org_quotas_ai_tokens;

SET FOREIGN_KEY_CHECKS = 1;
