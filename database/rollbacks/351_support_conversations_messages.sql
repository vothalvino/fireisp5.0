-- Rollback for migration 351 — drop support_messages and support_conversations
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_conversations;
