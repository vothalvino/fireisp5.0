-- =============================================================================
-- Migration 357 — §21.5 Default support channel configs (no-op)
-- =============================================================================
-- Default channel configs (web, sms, email, whatsapp, voice) are created
-- per-organization on first use by supportConversationService.
-- No global seed is needed here — org IDs are not known at migration time.
SELECT 1; -- idempotent no-op
