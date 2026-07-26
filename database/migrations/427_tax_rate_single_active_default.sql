-- =============================================================================
-- Migration 427 — guarantee at most ONE active default tax rate per org
-- =============================================================================
-- src/services/billingService.js resolveTaxContext picks the org's default with
--
--     SELECT id, rate FROM tax_rates
--      WHERE id = ? OR (organization_id = ? AND is_default = TRUE AND status = 'active' ...)
--      ORDER BY id = ? DESC LIMIT 1
--
-- When no explicit rate id is passed — which is every caller today, since
-- contracts has no tax_rate_id column — the ORDER BY key is a constant, so with
-- TWO active defaults the LIMIT 1 returns whichever row MySQL happens to hand
-- back first. Nothing in the schema or the route prevented that second default:
-- tax_rates had no uniqueness on (organization_id, is_default), and
-- src/routes/taxRates.js was a bare crudController with no hooks, so creating a
-- second default simply left both set.
--
-- The consequence is the worst shape this codebase has: not an error, but a
-- silently WRONG number. Every invoice, quote and credit note resolves its tax
-- through this function, so an org with a 16% IVA default and a leftover 0%
-- default bills some documents at 16% and others at 0%, with no signal
-- anywhere — and for a Mexican ISP those become SAT-stamped documents that
-- cannot be un-sent.
--
-- Same guard as migration 423 used for autopay profiles: a generated column that
-- carries the org identity ONLY for rows that are an active default, plus a
-- UNIQUE index on it. NULLs repeat freely in a MySQL unique index, so every
-- non-default, inactive or soft-deleted row stays unconstrained.
--
-- VIRTUAL, not STORED — 423 learned this the hard way. A STORED generated column
-- forces an ALGORITHM=COPY table rebuild, and tax_rates is the parent of FKs
-- from invoices, quotes, credit_notes and more, so the rebuild risks
-- ER_CANNOT_ADD_FOREIGN. VIRTUAL adds in place, and a unique index over a
-- virtual generated column is fully supported (MySQL materialises it in the
-- index).
--
-- IFNULL(organization_id, 0) matters: tax_rates.organization_id is
-- 'NULL = applies to all tenants', and CONCAT/arithmetic with NULL yields NULL,
-- which the unique index would then ignore — letting two GLOBAL defaults
-- coexist, the exact bug this closes. Org ids are AUTO_INCREMENT from 1, so 0
-- is a safe sentinel for "global".
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

-- Pre-clean any existing duplicate active defaults: keep the newest per org
-- scope, demote the rest — otherwise the UNIQUE index below cannot be built.
-- Migration 121's seeded rates are all is_default = FALSE, so this is a no-op on
-- a stock install and only bites where an operator created a second default.
UPDATE tax_rates t
JOIN (
  SELECT IFNULL(organization_id, 0) AS org_key, MAX(id) AS keep_id
  FROM tax_rates
  WHERE is_default = 1 AND status = 'active' AND deleted_at IS NULL
  GROUP BY IFNULL(organization_id, 0)
  HAVING COUNT(*) > 1
) dup
  ON dup.org_key = IFNULL(t.organization_id, 0)
SET t.is_default = 0
WHERE t.is_default = 1 AND t.status = 'active' AND t.deleted_at IS NULL
  AND t.id <> dup.keep_id;

DROP PROCEDURE IF EXISTS migration_427_tax_rate_default_guard;
DELIMITER //
CREATE PROCEDURE migration_427_tax_rate_default_guard()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rates'
      AND COLUMN_NAME  = 'default_guard'
  ) THEN
    ALTER TABLE tax_rates
      ADD COLUMN default_guard BIGINT UNSIGNED
        GENERATED ALWAYS AS (
          CASE WHEN is_default = 1 AND status = 'active' AND deleted_at IS NULL
               THEN IFNULL(organization_id, 0)
               ELSE NULL END
        ) VIRTUAL
        COMMENT 'One active default per org (0 = global): unique key, NULL when not an active default — migration 427';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rates'
      AND INDEX_NAME   = 'uq_tax_rates_default_guard'
  ) THEN
    ALTER TABLE tax_rates
      ADD UNIQUE KEY uq_tax_rates_default_guard (default_guard);
  END IF;
END //
DELIMITER ;

CALL migration_427_tax_rate_default_guard();
DROP PROCEDURE IF EXISTS migration_427_tax_rate_default_guard;
