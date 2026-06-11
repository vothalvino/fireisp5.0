-- =============================================================================
-- FireISP 5.0 — Rollback 172: Remove embedding_model column from ai_providers
-- =============================================================================
-- Reverses migration 172.
--
-- Guarded on INFORMATION_SCHEMA (MySQL 8 has no DROP COLUMN IF EXISTS); the
-- guard also makes this a safe no-op if ai_providers does not exist.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_172_drop_embedding_model;
DELIMITER //
CREATE PROCEDURE rollback_172_drop_embedding_model()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ai_providers'
      AND COLUMN_NAME  = 'embedding_model'
  ) THEN
    ALTER TABLE ai_providers DROP COLUMN embedding_model;
  END IF;
END //
DELIMITER ;
CALL rollback_172_drop_embedding_model();
DROP PROCEDURE IF EXISTS rollback_172_drop_embedding_model;
