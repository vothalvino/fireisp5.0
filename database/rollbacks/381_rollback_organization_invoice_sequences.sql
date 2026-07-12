-- =============================================================================
-- Rollback 381 — Atomic per-organization invoice-number sequence
-- =============================================================================
-- Drops organization_invoice_sequences. Safe: nothing else references this
-- table via foreign key, and the application code path that reads/writes it
-- (billingService.nextInvoiceNumber) only runs on the current codebase — a
-- rollback of this migration must be paired with reverting the application
-- code that calls it (billingService.js / routes/invoices.js /
-- routes/quotes.js), or invoice-number generation will throw on the missing
-- table. Dropping the table does NOT touch any existing invoices.invoice_number
-- values already issued.
-- =============================================================================

DROP TABLE IF EXISTS organization_invoice_sequences;
