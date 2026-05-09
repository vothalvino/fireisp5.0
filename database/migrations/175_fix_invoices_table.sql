-- Migration: 175_fix_invoices_table
-- Description: Aligns the invoices table with the application code:
--
--   1. organization_id (BIGINT UNSIGNED NULL):
--      billingService.generateInvoice() inserts this column from the caller's
--      orgId; the Invoice model lists it in FILLABLE; invoice routes scope
--      reads with WHERE organization_id = ?; the DSAR route exports it.
--      Without this column every invoice INSERT fails with "Unknown column".
--
--   2. issued_at (DATETIME NULL DEFAULT CURRENT_TIMESTAMP):
--      The DSAR export query selects issued_at.  issue_date (DATE) is the
--      accounting date; issued_at is the exact timestamp the invoice record
--      was created.  Adding it with a server-side default means no INSERT
--      changes are required.
--
--   3. issue_date DEFAULT (CURRENT_DATE):
--      billingService INSERT does not include issue_date.  Without a DEFAULT
--      MySQL rejects the INSERT in STRICT_TRANS_TABLES mode (the default in
--      MySQL 8+).  Expression defaults are supported in MySQL 8.0.13+.
--
--   4. status ENUM expanded to ('draft','issued','sent','paid','overdue',
--      'cancelled','void'):
--      billingService inserts 'issued'; the validation schema allows 'issued'
--      and 'void'; the original ENUM only had draft/sent/paid/overdue/cancelled.

ALTER TABLE invoices
  ADD COLUMN organization_id BIGINT UNSIGNED NULL
    COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
    AFTER id,
  ADD COLUMN issued_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
    COMMENT 'Timestamp when the invoice record was created (used by DSAR export)'
    AFTER due_date,
  MODIFY COLUMN issue_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    COMMENT 'Billing date of the invoice',
  MODIFY COLUMN status
    ENUM('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled', 'void')
    NOT NULL DEFAULT 'draft';

-- Back-fill organization_id from each invoice's owning client
UPDATE invoices i
  JOIN clients c ON c.id = i.client_id
SET i.organization_id = c.organization_id
WHERE i.organization_id IS NULL;

-- Index and FK for organization_id
ALTER TABLE invoices
  ADD KEY idx_invoices_organization_id (organization_id),
  ADD KEY idx_invoices_org_status (organization_id, status),
  ADD CONSTRAINT fk_invoices_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
