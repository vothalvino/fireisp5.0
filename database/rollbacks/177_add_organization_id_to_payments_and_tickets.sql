-- =============================================================================
-- FireISP 5.0 — Rollback 177: Remove organization_id from payments and tickets
-- =============================================================================
-- Reverses migration 177 by dropping the organization_id foreign keys, indexes,
-- and columns from the payments and tickets tables.
-- =============================================================================

ALTER TABLE payments
  DROP FOREIGN KEY fk_payments_organization;

ALTER TABLE payments
  DROP INDEX idx_payments_organization_id,
  DROP COLUMN organization_id;

ALTER TABLE tickets
  DROP FOREIGN KEY fk_tickets_organization;

ALTER TABLE tickets
  DROP INDEX idx_tickets_organization_id,
  DROP COLUMN organization_id;
