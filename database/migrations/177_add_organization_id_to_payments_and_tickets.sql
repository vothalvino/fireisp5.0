-- Migration: 177_add_organization_id_to_payments_and_tickets
-- Description: Adds organization_id to payments and tickets tables.
--
-- The payments route sets req.body.organization_id = req.orgId before calling
-- Payment.create(), and Payment.fillable includes 'organization_id', so
-- BaseModel.create() tries to INSERT that column — failing with "Unknown column"
-- because the column was never added to the table.
--
-- The tickets route does the same: req.body.organization_id = req.orgId and
-- Ticket.fillable includes 'organization_id'.  Same root cause.
--
-- Both tables also need the column for multi-tenant org-scoped queries that
-- use WHERE organization_id = ? in the application routes.

-- ── payments ─────────────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD COLUMN organization_id BIGINT UNSIGNED NULL
    COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
    AFTER id;

-- Back-fill organization_id from the owning client
UPDATE payments p
  JOIN clients c ON c.id = p.client_id
SET p.organization_id = c.organization_id
WHERE p.organization_id IS NULL;

ALTER TABLE payments
  ADD KEY idx_payments_organization_id (organization_id),
  ADD CONSTRAINT fk_payments_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── tickets ──────────────────────────────────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN organization_id BIGINT UNSIGNED NULL
    COMMENT 'Owning tenant organisation; NULL = single-tenant deployment'
    AFTER id;

-- Back-fill organization_id from the owning client
UPDATE tickets t
  JOIN clients c ON c.id = t.client_id
SET t.organization_id = c.organization_id
WHERE t.organization_id IS NULL;

ALTER TABLE tickets
  ADD KEY idx_tickets_organization_id (organization_id),
  ADD CONSTRAINT fk_tickets_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
