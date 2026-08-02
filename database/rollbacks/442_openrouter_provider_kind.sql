-- =============================================================================
-- Rollback 442 — Remove 'openrouter' from ai_providers.kind
-- =============================================================================
-- DESTRUCTIVE IF ROWS USE IT. Narrowing an ENUM turns any row holding the
-- removed value into '' (with a warning) or fails under STRICT mode. So this
-- refuses to run while any provider still uses the kind, rather than quietly
-- corrupting the registry — delete or re-point those providers first.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_442_openrouter_provider_kind;
DELIMITER //
CREATE PROCEDURE rollback_442_openrouter_provider_kind()
BEGIN
  DECLARE in_use INT DEFAULT 0;

  SELECT COUNT(*) INTO in_use FROM ai_providers WHERE kind = 'openrouter';

  IF in_use > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Rollback 442 aborted: ai_providers rows still use kind=openrouter. Delete or change them first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA  = DATABASE()
      AND TABLE_NAME    = 'ai_providers'
      AND COLUMN_NAME   = 'kind'
      AND COLUMN_TYPE LIKE '%openrouter%'
  ) THEN
    ALTER TABLE ai_providers
      MODIFY COLUMN kind
        ENUM('openai','azure_openai','anthropic','gemini','ollama','custom')
        NOT NULL DEFAULT 'openai'
        COMMENT 'Admin-visible provider adapter';
  END IF;
END //
DELIMITER ;
CALL rollback_442_openrouter_provider_kind();
DROP PROCEDURE IF EXISTS rollback_442_openrouter_provider_kind;
