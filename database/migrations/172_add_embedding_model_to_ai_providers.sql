-- Migration: 172_add_embedding_model_to_ai_providers
-- Guarded with an INFORMATION_SCHEMA check so the migration is safely
-- re-runnable after a partial failure.

DROP PROCEDURE IF EXISTS migration_172_add_embedding_model;
DELIMITER //
CREATE PROCEDURE migration_172_add_embedding_model()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ai_providers'
      AND COLUMN_NAME  = 'embedding_model'
  ) THEN
    ALTER TABLE ai_providers
      ADD COLUMN embedding_model VARCHAR(100) NULL
        COMMENT 'Model used for text embeddings. NULL = use kind default (text-embedding-3-small / nomic-embed-text / embedding-001).'
        AFTER model;
  END IF;
END //
DELIMITER ;
CALL migration_172_add_embedding_model();
DROP PROCEDURE IF EXISTS migration_172_add_embedding_model;
