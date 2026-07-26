-- =============================================================================
-- Migration 426 — Give the radius table an organization_id
-- =============================================================================
-- Part 2 of the BaseModel org-scoping sweep (425 did device_config_backups and
-- recurring_payment_profiles).
--
-- radius is the sharpest remaining case because it looks ALREADY FIXED and is
-- not. src/models/Radius.js overrides findById, findAll and count with a
-- `JOIN clients cl ON cl.id = r.client_id AND cl.organization_id = ?` — so
-- READS are correctly scoped, and a reviewer skimming the model concludes the
-- table is safe.
--
-- update, delete and restore are NOT overridden. They fall through to
-- BaseModel, which at line 99 reads
--
--     if (orgId !== null && this.hasOrgScope) { conditions.push('organization_id = ?') }
--
-- and hasOrgScope was false, so those three ran with NO org predicate at all.
-- The radius table holds `username` and `password` — the PPPoE credentials a
-- subscriber authenticates with — so any tenant could REWRITE another tenant's
-- subscriber credentials, or soft-delete them, by id. Disconnecting a rival
-- ISP's customers is a one-request operation.
--
-- That asymmetry is the argument for a column over a parent JOIN generally: the
-- JOIN has to be remembered per method, six times, and here it was remembered
-- three times out of six.
--
-- The JOIN overrides are deliberately KEPT (see the model). They serve the
-- RADIUS authentication path with an explicit SAFE_COLUMNS list and have their
-- own security tests; this column closes the write paths they never covered.
--
-- client_id is NOT NULL, so the backfill is unambiguous — every radius row has
-- exactly one client and therefore exactly one owning org.
--
-- The column is NULLABLE, matching clients.organization_id, which is itself
-- 'NULL = single-tenant deployment'. A NOT NULL column would be unsatisfiable
-- on a single-tenant install, where the backfill legitimately yields NULL.
-- BaseModel.js:99 applies no org predicate when req.orgId is null, so those
-- rows stay visible to the deployment that owns them.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_426_org_scope_radius;
DELIMITER //
CREATE PROCEDURE migration_426_org_scope_radius()
BEGIN
  -- A leftover index from a previous rollback would make ADD KEY below fail
  -- with ER_DUP_KEYNAME: dropping a column does NOT drop a multi-column index
  -- containing it, MySQL just removes that column from the index. Migration 425
  -- learned this from a red CI rollback round-trip.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND INDEX_NAME   = 'idx_radius_org'
  ) THEN
    ALTER TABLE radius DROP INDEX idx_radius_org;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    -- Nullable first so the backfill can run; tightened below.
    ALTER TABLE radius
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from clients (migration 426)'
          AFTER id;

    UPDATE radius r
      JOIN clients cl ON cl.id = r.client_id
       SET r.organization_id = cl.organization_id;

    ALTER TABLE radius
      ADD KEY idx_radius_org (organization_id, client_id),
      ADD CONSTRAINT fk_radius_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;

CALL migration_426_org_scope_radius();
DROP PROCEDURE IF EXISTS migration_426_org_scope_radius;
