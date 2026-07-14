-- =============================================================================
-- Rollback 389 — Atomic per-organization quote-number sequence
-- =============================================================================
-- Drops organization_quote_sequences. Safe: nothing else references this
-- table via foreign key, and the application code path that reads/writes it
-- (billingService.nextQuoteNumber) only runs on the current codebase — a
-- rollback of this migration must be paired with reverting the application
-- code that calls it (billingService.js / routes/quotes.js), or quote-number
-- generation will throw on the missing table. Dropping the table does NOT
-- touch any existing quotes.quote_number values already issued.
-- =============================================================================

DROP TABLE IF EXISTS organization_quote_sequences;
