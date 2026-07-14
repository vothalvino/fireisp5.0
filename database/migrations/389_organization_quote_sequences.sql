-- =============================================================================
-- Migration 389 — Atomic per-organization quote-number sequence
-- =============================================================================
-- Quotes had no auto-numbering at all: `quotes.quote_number` is NOT NULL with
-- no default, and unlike invoices (migration 381's
-- organization_invoice_sequences + billingService.nextInvoiceNumber) nothing
-- ever assigned one — every caller had to supply quote_number itself or the
-- INSERT would fail the NOT NULL constraint. This mirrors migration 381
-- exactly, shape-for-shape, for quotes: a one-row-per-org atomic counter table
-- backing a new `billingService.nextQuoteNumber(conn, orgId)` helper (same
-- INSERT IGNORE + UPDATE ... LAST_INSERT_ID(next_number)+1 idiom — NOT a
-- single `ON DUPLICATE KEY UPDATE`, which does not reliably run its
-- LAST_INSERT_ID() expression on a fresh insert into a table with no
-- AUTO_INCREMENT column; see nextInvoiceNumber's doc comment for the full
-- reasoning), producing QUO-###### numbers.
--
-- `organization_id` is the PRIMARY KEY directly (not a surrogate id) so a
-- single-round-trip `INSERT IGNORE` can target it; sentinel value 0
-- represents the NULL-organization ("single-tenant deployment") bucket, same
-- convention as organization_invoice_sequences and organization_order_sequences.
--
-- Existing organizations are seeded from current data: for each org
-- (including the NULL-org bucket, grouped as 0), next_number is set to
-- 1 + the greater of (a) the highest numeric suffix parsed out of any
-- existing 'QUO-%' quote_number (across ALL quotes, including soft-deleted
-- ones — deleted rows still occupied a number and must not be reissued) and
-- (b) COUNT(*) of all quotes for that org (a conservative fallback for orgs
-- whose quote numbers don't follow the QUO-###### pattern). Orgs with zero
-- quote rows get no seed row at all — nextQuoteNumber() lazily creates one
-- starting at 1 on first use, same as nextInvoiceNumber().
--
-- Pure INSERT — no ALTER — so a plain INSERT-guard (INSERT IGNORE against the
-- PRIMARY KEY) is sufficient for idempotency.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_quote_sequences (
    organization_id BIGINT UNSIGNED NOT NULL COMMENT 'Owning tenant organisation; sentinel 0 = the NULL/single-tenant-deployment bucket (quotes.organization_id IS NULL) since primary keys cannot de-duplicate NULL',
    next_number     BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Next QUO-###### sequence value to hand out; advanced atomically by billingService.nextQuoteNumber()',
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Atomic per-organization quote-number counter (migration 389) — mirrors organization_invoice_sequences (migration 381)';

-- -----------------------------------------------------------------------------
-- Seed from existing quote data. GREATEST() of the parsed numeric suffix and
-- the raw row count guards both directions, same as migration 381's invoice
-- seed. INSERT IGNORE keeps this idempotent.
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO organization_quote_sequences (organization_id, next_number)
SELECT
    COALESCE(organization_id, 0) AS org_bucket,
    GREATEST(
        COALESCE(MAX(
            CASE
                WHEN quote_number LIKE 'QUO-%' AND SUBSTRING(quote_number, 5) REGEXP '^[0-9]+$'
                    THEN CAST(SUBSTRING(quote_number, 5) AS UNSIGNED)
            END
        ), 0),
        COUNT(*)
    ) + 1 AS next_number
FROM quotes
GROUP BY COALESCE(organization_id, 0);
