-- =============================================================================
-- Rollback 386 — Per-organization outbound email (SMTP) configuration
-- =============================================================================
-- Drops organization_email_settings. A rollback of this migration must be
-- paired with reverting the application code that reads/writes it
-- (src/models/EmailSettings.js, src/routes/emailSettings.js,
-- src/services/emailTransport.js's org-aware sendEmail path), or those code
-- paths will throw on the missing table / column.
--
-- email_logs.organization_id is intentionally LEFT IN PLACE — it is an
-- additive, nullable column with backfilled data; dropping it would discard
-- that backfill for no benefit and risks breaking any code that has already
-- started reading it (mirrors migration 381's rollback note on one-directional
-- additive changes).
-- =============================================================================

DROP TABLE IF EXISTS organization_email_settings;
