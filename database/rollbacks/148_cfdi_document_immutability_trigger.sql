-- =============================================================================
-- FireISP 5.0 — Rollback 148: Drop CFDI document immutability trigger
-- =============================================================================
-- Reverses migration 148.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_cfdi_documents_immutable_bu;
