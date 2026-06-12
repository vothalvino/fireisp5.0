-- =============================================================================
-- Rollback 295: Customer Self-Service Portal Tables — §11
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS portal_push_subscriptions;
DROP TABLE IF EXISTS portal_chat_sessions;
DROP TABLE IF EXISTS portal_kb_articles;
DROP TABLE IF EXISTS portal_service_requests;

SET FOREIGN_KEY_CHECKS=1;
