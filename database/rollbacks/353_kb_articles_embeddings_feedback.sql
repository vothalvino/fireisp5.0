-- Rollback for migration 353 — drop kb_feedback, kb_article_embeddings, kb_articles
DROP TABLE IF EXISTS kb_feedback;
DROP TABLE IF EXISTS kb_article_embeddings;
DROP TABLE IF EXISTS kb_articles;
