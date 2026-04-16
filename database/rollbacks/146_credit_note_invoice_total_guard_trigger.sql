-- =============================================================================
-- FireISP 5.0 — Rollback 146: Drop credit note invoice total guard triggers
-- =============================================================================
-- Reverses migration 146.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bi;
DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bu;
