-- =============================================================================
-- FireISP 5.0 — Rollback 147: Drop audit log immutability triggers
-- =============================================================================
-- Reverses migration 147.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bd;
