-- =============================================================================
-- Migration 437 — give outages an organization_id
-- =============================================================================
-- Continues the BaseModel org-scoping sweep (425 device_config_backups +
-- recurring_payment_profiles, 426 radius, 429 sla_definitions, 582
-- scheduled_tasks).
--
-- src/models/Outage.js declares hasOrgScope = false, and src/models/BaseModel.js
-- omits the org predicate SILENTLY when it does — so list, get, update, delete
-- and restore all ran unscoped behind the generic crudController. GET /outages
-- returned every outage on the install to every tenant: titles, root_cause free
-- text, affected client counts. Writes were worse than the read: any tenant
-- could retitle, re-time, resolve or delete another tenant's outage, and the
-- afterUpdate hook then emitted outage.resolved into the EDITING org's channel,
-- so the owning NOC never heard about it.
--
-- BACKFILL — site first, then device, and never demote.
--   site_id and device_id are BOTH nullable and either may be set, so the two
--   can disagree. Site wins when it has an org, because an outage recorded
--   against a site is a statement about that site's service area; the device is
--   evidence. COALESCE means a row with only one of the two still resolves,
--   and a row whose site has a NULL org falls through to the device rather than
--   being demoted to unattributed.
--
-- ROWS WITH NEITHER stay NULL. There is nothing to derive an owner from, and
-- inventing one would be worse than leaving it visible. They are LEGACY ONLY:
-- from this migration on, every outage is stamped at creation (crudController
-- injects it once hasOrgScope is true, and alertService now passes it), so the
-- unattributed set is closed and can only shrink. The route lets the first
-- tenant that writes to one ADOPT it, which is what stops an unattributed
-- 'ongoing' outage sitting un-resolvable on every tenant's NOC dashboard.
--
-- NULLABLE, like every other org column here: sites.organization_id and
-- devices.organization_id are themselves 'NULL = single-tenant', so a
-- single-tenant install legitimately backfills to NULL. A NOT NULL column could
-- only be reconciled by DELETING those rows.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_437_org_scope_outages;
DELIMITER //
CREATE PROCEDURE migration_437_org_scope_outages()
BEGIN
  -- A leftover index from a previous rollback would make ADD KEY fail with
  -- ER_DUP_KEYNAME: dropping a column does not drop a multi-column index
  -- containing it. Migration 425 learned this from a red CI rollback.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'outages'
      AND INDEX_NAME   = 'idx_outages_org'
  ) THEN
    ALTER TABLE outages DROP INDEX idx_outages_org;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'outages'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE outages
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from site/device; NULL = unattributed legacy row, adoptable on write (migration 437)'
          AFTER id;

    -- Site first, device second. LEFT JOINs so a row with only one of the two
    -- still resolves; COALESCE so a site with a NULL org falls through to the
    -- device instead of demoting an attributable row.
    UPDATE outages o
      LEFT JOIN sites   s ON s.id = o.site_id
      LEFT JOIN devices d ON d.id = o.device_id
       SET o.organization_id = COALESCE(s.organization_id, d.organization_id);

    -- (organization_id, status) — the hot read is "ongoing outages for my org"
    -- on the NOC dashboard, which filters on exactly this pair.
    ALTER TABLE outages
      ADD KEY idx_outages_org (organization_id, status),
      ADD CONSTRAINT fk_outages_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;

CALL migration_437_org_scope_outages();
DROP PROCEDURE IF EXISTS migration_437_org_scope_outages;
