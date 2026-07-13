-- =============================================================================
-- Migration 384 — Atomic per-organization service-order-number sequence
-- =============================================================================
-- lifecycleService.generateOrderNumber computed the next SO-###### number via
-- `SELECT COUNT(*) AS cnt FROM service_orders WHERE organization_id <=> ?`
-- then `cnt + 1`. COUNT(*) is a non-locking read: two concurrent POST
-- /service-orders for the same org (or the NULL-org bucket) can both read the
-- same count and both attempt to INSERT the same order_number, raising an
-- unhandled 500 on the uq_service_orders_org_number unique-key violation
-- inside the route's transaction. This is the exact race class migration 381
-- fixed for invoice numbering (organization_invoice_sequences) — it was
-- explicitly called out at the time as a separate, still-COUNT(*)-based
-- helper intentionally left out of scope for that migration (see the README
-- note this migration replaces).
--
-- This migration adds `organization_order_sequences`, a one-row-per-org
-- atomic counter table mirroring organization_invoice_sequences exactly:
-- `organization_id` is the PRIMARY KEY directly (not a surrogate id), and
-- sentinel value 0 represents the NULL-organization ("single-tenant
-- deployment") bucket, since MySQL primary/unique keys treat NULL as
-- distinct from itself and would not de-duplicate a nullable PK column the
-- way this table needs. 0 is never a real organizations.id (AUTO_INCREMENT
-- starts at 1), so the sentinel can't collide with a tenant.
--
-- A second table (rather than generalizing organization_invoice_sequences
-- with a `kind` column) is the lower-risk choice: organization_invoice_
-- sequences' PK is bare `organization_id`, which cannot host a second
-- row-kind without a composite-key migration on an already-deployed table.
-- This matches the existing precedent of one sequence table per
-- numbered-entity type.
--
-- Existing organizations are seeded from current data: for each org
-- (including the NULL-org bucket, grouped as 0), next_number is set to 1 +
-- the greater of (a) the highest numeric suffix parsed out of any existing
-- 'SO-%' order_number (across ALL service_orders, including soft-deleted
-- ones — a deleted row still occupied a number and must not be reissued)
-- and (b) COUNT(*) of all service_orders for that org (a conservative
-- fallback for orgs whose order numbers don't all follow the SO-######
-- pattern). Orgs with zero service_order rows get no seed row at all —
-- nextOrderNumber() (src/services/lifecycleService.js) lazily creates one
-- starting at 1 on first use via `INSERT IGNORE`, which is correct both for
-- a genuinely new org and one seeded here (whose row already exists by the
-- time nextOrderNumber() is first called).
--
-- Pure INSERT — no ALTER — so a plain INSERT-guard is sufficient for
-- idempotency (INSERT IGNORE against the PRIMARY KEY skips orgs that already
-- have a row on re-run).
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_order_sequences (
    organization_id BIGINT UNSIGNED NOT NULL COMMENT 'Owning tenant organisation; sentinel 0 = the NULL/single-tenant-deployment bucket (service_orders.organization_id IS NULL) since primary keys cannot de-duplicate NULL',
    next_number     BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Next SO-###### sequence value to hand out; advanced atomically by lifecycleService.nextOrderNumber()',
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Atomic per-organization service-order-number counter (migration 384) — replaces the collision-prone COUNT(*)+1 pattern';

-- -----------------------------------------------------------------------------
-- Seed from existing service_order data. GREATEST() of the parsed numeric
-- suffix and the raw row count guards both directions: it never under-shoots
-- the highest number actually in use, and never under-shoots the row count
-- for orgs whose numbers don't parse. INSERT IGNORE keeps this idempotent —
-- an org that already has a row (e.g. this migration re-run) is left
-- untouched rather than having its counter clobbered backwards.
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO organization_order_sequences (organization_id, next_number)
SELECT
    COALESCE(organization_id, 0) AS org_bucket,
    GREATEST(
        COALESCE(MAX(
            CASE
                WHEN order_number LIKE 'SO-%' AND SUBSTRING(order_number, 4) REGEXP '^[0-9]+$'
                    THEN CAST(SUBSTRING(order_number, 4) AS UNSIGNED)
            END
        ), 0),
        COUNT(*)
    ) + 1 AS next_number
FROM service_orders
GROUP BY COALESCE(organization_id, 0);
