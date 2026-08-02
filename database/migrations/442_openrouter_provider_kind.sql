-- =============================================================================
-- Migration 442 — Add 'openrouter' to ai_providers.kind
-- =============================================================================
-- OpenRouter is a single API in front of hundreds of models from many vendors.
-- It already worked through the generic 'custom' kind, because it speaks the
-- OpenAI chat-completions shape — but only for an admin willing to hand-write
-- the endpoint URL, the Bearer prefix and a headers map into extra_config.
--
-- Making it a first-class kind removes all of that: the endpoint has exactly one
-- correct value, so the app supplies it, and the model becomes a picker fed by
-- OpenRouter's live public catalog (see src/services/openRouterCatalog.js)
-- rather than a hardcoded list that goes stale the week a new model ships.
--
-- ENUM values are APPENDED, never reordered: MySQL stores an ENUM as the ordinal
-- index of its value, so inserting 'openrouter' anywhere but the end would
-- silently relabel every existing row.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_442_openrouter_provider_kind;
DELIMITER //
CREATE PROCEDURE migration_442_openrouter_provider_kind()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA  = DATABASE()
      AND TABLE_NAME    = 'ai_providers'
      AND COLUMN_NAME   = 'kind'
      AND COLUMN_TYPE LIKE '%openrouter%'
  ) THEN
    ALTER TABLE ai_providers
      MODIFY COLUMN kind
        ENUM('openai','azure_openai','anthropic','gemini','ollama','custom','openrouter')
        NOT NULL DEFAULT 'openai'
        COMMENT 'Provider adapter to dispatch to. openrouter added in migration 442.';
  END IF;
END //
DELIMITER ;
CALL migration_442_openrouter_provider_kind();
DROP PROCEDURE IF EXISTS migration_442_openrouter_provider_kind;
