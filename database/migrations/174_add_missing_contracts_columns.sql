-- Migration: 174_add_missing_contracts_columns
-- Description: Adds organization_id, billing_day, and ip_address columns to the
--              contracts table.  These fields are referenced by the Contract model
--              FILLABLE list, the suspend/unsuspend routes (WHERE organization_id = ?),
--              and the API validation schema — but were never present in the table,
--              causing MySQL errors on every contract creation or org-scoped lookup.
--
--              Backfill: organization_id is populated from the owning client row so
--              existing contracts are immediately tenant-scoped without manual work.

ALTER TABLE contracts
  ADD COLUMN organization_id BIGINT UNSIGNED NULL
    COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
    AFTER id,
  ADD COLUMN billing_day TINYINT UNSIGNED NULL
    COMMENT 'Day of month (1–28) on which invoices are generated; NULL = inherit from plan'
    AFTER end_date,
  ADD COLUMN ip_address VARCHAR(45) NULL
    COMMENT 'Static IPv4/IPv6 address assigned to this service; NULL = dynamic'
    AFTER billing_day;

-- Back-fill organization_id from the owning client
UPDATE contracts c
  JOIN clients cl ON cl.id = c.client_id
SET c.organization_id = cl.organization_id
WHERE c.organization_id IS NULL;

-- Index and FK for organization_id
ALTER TABLE contracts
  ADD KEY idx_contracts_organization_id (organization_id),
  ADD KEY idx_contracts_org_status (organization_id, status),
  ADD CONSTRAINT fk_contracts_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
