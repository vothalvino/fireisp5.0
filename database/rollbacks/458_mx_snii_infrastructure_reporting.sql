-- =============================================================================
-- Rollback 458 — remove MX SNII preparation storage
-- =============================================================================
-- Filing, export and audit records are regulatory evidence.  A software
-- rollback must not erase or make that evidence mutable, so every table,
-- immutability trigger, permission definition and grant is retained.  The
-- application rollback removes the route surface; a separately authorized
-- records-disposition process is required to destroy evidence.
-- =============================================================================

SELECT 1 AS snii_evidence_retained;
