-- =============================================================================
-- Migration 381 — Atomic per-organization invoice-number sequence
-- =============================================================================
-- Every invoice-number generation site (billingService.generateInvoice,
-- billingService.createOneOffInvoice, POST /invoices/generate, POST
-- /quotes/:id/convert-to-invoice) computed the next INV-###### number as
-- `SELECT COUNT(*) FROM invoices WHERE organization_id = ?` then `cnt + 1`.
-- COUNT(*) is a non-locking read: two concurrent invoice-generation calls for
-- the same organization (e.g. a scheduled auto-invoice run overlapping a
-- manual "Generate Invoice" click, or two bulk-generate requests) can both
-- read the same count and both attempt to INSERT the same invoice_number,
-- raising a 500 on the uq_invoices_org_number unique-key violation. The same
-- COUNT(*)-vs-actual-max divergence can also occur whenever the row count
-- doesn't track the highest issued sequence value (imported/legacy invoice
-- numbers with gaps, or any invoice_number not on the INV-###### pattern).
--
-- This migration adds `organization_invoice_sequences`, a one-row-per-org
-- atomic counter table. `organization_id` is the PRIMARY KEY directly (not a
-- surrogate id) so `INSERT ... ON DUPLICATE KEY UPDATE` can target it in a
-- single round trip; sentinel value 0 represents the NULL-organization
-- ("single-tenant deployment") bucket used elsewhere in this codebase
-- (invoices.organization_id NULL), because MySQL unique/primary keys treat
-- NULL as distinct from itself and would not de-duplicate a nullable PK
-- column the way this table needs. 0 is never a real organizations.id
-- (AUTO_INCREMENT starts at 1), so the sentinel can't collide with a tenant.
--
-- Existing organizations are seeded from the current data: for each org
-- (including the NULL-org bucket, grouped as 0), next_number is set to
-- 1 + the greater of (a) the highest numeric suffix parsed out of any
-- existing 'INV-%' invoice_number (across ALL invoices, including
-- soft-deleted ones — deleted rows still occupied a number and must not be
-- reissued) and (b) COUNT(*) of all invoices for that org (a conservative
-- fallback for orgs whose invoice numbers don't all follow the INV-######
-- pattern, e.g. imported/legacy data). Orgs with zero invoice rows get no
-- seed row at all — nextInvoiceNumber() (src/services/billingService.js)
-- lazily creates one starting at 1 on first use via
-- `INSERT ... ON DUPLICATE KEY UPDATE`, which is correct for both a
-- genuinely new org and one seeded here (whose row already exists by the
-- time nextInvoiceNumber() is first called).
--
-- Pure INSERT — no ALTER — so a plain INSERT-guard is sufficient for
-- idempotency (INSERT IGNORE against the PRIMARY KEY skips orgs that already
-- have a row on re-run, matching the seeded row's normal "won't overwrite an
-- already-advanced counter" behaviour without needing a stored procedure).
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_invoice_sequences (
    organization_id BIGINT UNSIGNED NOT NULL COMMENT 'Owning tenant organisation; sentinel 0 = the NULL/single-tenant-deployment bucket (invoices.organization_id IS NULL) since primary keys cannot de-duplicate NULL',
    next_number     BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Next INV-###### sequence value to hand out; advanced atomically by billingService.nextInvoiceNumber()',
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Atomic per-organization invoice-number counter (migration 381) — replaces the collision-prone COUNT(*)+1 pattern';

-- -----------------------------------------------------------------------------
-- Seed from existing invoice data. GREATEST() of the parsed numeric suffix and
-- the raw row count guards both directions: it never under-shoots the highest
-- number actually in use, and never under-shoots the row count for orgs whose
-- numbers don't parse. INSERT IGNORE keeps this idempotent — an org that
-- already has a row (e.g. this migration re-run, or a row lazily created by
-- nextInvoiceNumber() before this statement runs in some replay scenario) is
-- left untouched rather than having its counter clobbered backwards.
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO organization_invoice_sequences (organization_id, next_number)
SELECT
    COALESCE(organization_id, 0) AS org_bucket,
    GREATEST(
        COALESCE(MAX(
            CASE
                WHEN invoice_number LIKE 'INV-%' AND SUBSTRING(invoice_number, 5) REGEXP '^[0-9]+$'
                    THEN CAST(SUBSTRING(invoice_number, 5) AS UNSIGNED)
            END
        ), 0),
        COUNT(*)
    ) + 1 AS next_number
FROM invoices
GROUP BY COALESCE(organization_id, 0);
