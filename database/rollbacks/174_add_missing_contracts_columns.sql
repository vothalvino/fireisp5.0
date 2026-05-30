-- =============================================================================
-- FireISP 5.0 — Rollback 174: Remove contracts org/billing columns
-- =============================================================================
-- Reverses migration 174 by dropping the organization_id foreign key, its
-- indexes, and the organization_id, billing_day, and ip_address columns.
-- =============================================================================

ALTER TABLE contracts
  DROP FOREIGN KEY fk_contracts_organization;

ALTER TABLE contracts
  DROP INDEX idx_contracts_organization_id,
  DROP INDEX idx_contracts_org_status,
  DROP COLUMN organization_id,
  DROP COLUMN billing_day,
  DROP COLUMN ip_address;
