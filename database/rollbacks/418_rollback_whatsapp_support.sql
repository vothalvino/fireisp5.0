-- Rollback 418 — drop the WhatsApp customer-support tables.
-- Order respects FKs (children reference clients/organizations, not each other).
DROP TABLE IF EXISTS whatsapp_inbound_messages;
DROP TABLE IF EXISTS whatsapp_verifications;
DROP TABLE IF EXISTS whatsapp_links;
