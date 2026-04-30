ALTER TABLE ai_providers
  ADD COLUMN embedding_model VARCHAR(100) NULL
    COMMENT 'Model used for text embeddings. NULL = use kind default (text-embedding-3-small / nomic-embed-text / embedding-001).'
    AFTER model;
