-- =============================================================================
-- FireISP 5.0 — Rollback 175: Revert invoices table fixes
-- =============================================================================
-- Reverses migration 175 by dropping the organization_id FK/indexes and the
-- organization_id and issued_at columns, and restoring issue_date and the
-- status ENUM to their pre-175 definitions.
--
-- NOTE: restoring the narrower status ENUM will fail if any invoice still uses
-- the 'issued' or 'void' status; update those rows before rolling back.
-- =============================================================================

ALTER TABLE invoices
  DROP FOREIGN KEY fk_invoices_organization;

ALTER TABLE invoices
  DROP INDEX idx_invoices_organization_id,
  DROP INDEX idx_invoices_org_status,
  DROP COLUMN organization_id,
  DROP COLUMN issued_at,
  MODIFY COLUMN issue_date DATE NOT NULL,
  MODIFY COLUMN status
    ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled')
    NOT NULL DEFAULT 'draft';
