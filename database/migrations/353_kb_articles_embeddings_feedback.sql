-- =============================================================================
-- Migration 353 — §21.4 Knowledge Base: articles, embeddings, feedback
-- Tables: kb_articles, kb_article_embeddings, kb_feedback
-- =============================================================================

CREATE TABLE IF NOT EXISTS kb_articles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(500)    NOT NULL,
  body            TEXT            NOT NULL,
  category        VARCHAR(100)    NOT NULL DEFAULT 'general',
  locale          VARCHAR(10)     NOT NULL DEFAULT 'es',
  tags            VARCHAR(500)    NULL,
  is_published    TINYINT(1)      NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kba_org       (organization_id),
  KEY idx_kba_category  (category),
  KEY idx_kba_locale    (locale),
  KEY idx_kba_published (is_published),
  CONSTRAINT fk_kba_org  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_kba_user FOREIGN KEY (created_by)      REFERENCES users         (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kb_article_embeddings (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id  BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NULL,
  embedding   MEDIUMBLOB      NULL,
  dimensions  INT             NOT NULL DEFAULT 1536,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kbe_article  (article_id),
  KEY idx_kbe_provider (provider_id),
  CONSTRAINT fk_kbe_article  FOREIGN KEY (article_id)  REFERENCES kb_articles  (id) ON DELETE CASCADE,
  CONSTRAINT fk_kbe_provider FOREIGN KEY (provider_id) REFERENCES ai_providers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kb_feedback (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id      BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NULL,
  feedback        ENUM('helpful','wrong','partial') NOT NULL,
  notes           VARCHAR(500)    NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kbf_article (article_id),
  KEY idx_kbf_conv    (conversation_id),
  CONSTRAINT fk_kbf_article FOREIGN KEY (article_id)      REFERENCES kb_articles         (id) ON DELETE CASCADE,
  CONSTRAINT fk_kbf_conv    FOREIGN KEY (conversation_id) REFERENCES support_conversations (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
