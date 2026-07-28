-- =============================================================================
-- Migration 429 — give sla_definitions an organization_id
-- =============================================================================
-- Part 3 of the BaseModel org-scoping sweep (425 did device_config_backups and
-- recurring_payment_profiles; 426 did radius).
--
-- src/models/SlaDefinition.js declares hasOrgScope = false, and
-- src/models/BaseModel.js omits the org predicate SILENTLY when it does — so
-- list, get, update, delete and restore all ran unscoped behind
-- src/routes/slaDefinitions.js's generic crudController. An SLA definition is
-- the contractual commitment a tenant makes to its subscribers (uptime %,
-- response and resolution minutes, and the compensation owed when it is
-- missed), so this exposed one ISP's service terms and penalty rates to every
-- other ISP on the install, and let them edit or delete them.
--
-- plan_id is NOT NULL and FKs to plans, so the backfill is unambiguous: every
-- SLA belongs to exactly one plan and therefore to exactly one org.
--
-- NULLABLE, like every other org column in this schema (and like 425/426 after
-- the correction): plans.organization_id is itself 'NULL = single-tenant
-- deployment', so a single-tenant install legitimately backfills to NULL, and a
-- NOT NULL column could only be reconciled by DELETING those rows. BaseModel
-- applies no predicate when req.orgId is null, so those rows stay visible to
-- the deployment that owns them.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_429_org_scope_sla_definitions;
DELIMITER //
CREATE PROCEDURE migration_429_org_scope_sla_definitions()
BEGIN
  -- A leftover index from a previous rollback would make ADD KEY fail with
  -- ER_DUP_KEYNAME: dropping a column does not drop a multi-column index
  -- containing it. Migration 425 learned this from a red CI rollback round-trip.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sla_definitions'
      AND INDEX_NAME   = 'idx_sla_definitions_org'
  ) THEN
    ALTER TABLE sla_definitions DROP INDEX idx_sla_definitions_org;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sla_definitions'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE sla_definitions
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from plans; NULL = single-tenant (migration 429)'
          AFTER id;

    UPDATE sla_definitions s
      JOIN plans p ON p.id = s.plan_id
       SET s.organization_id = p.organization_id;

    ALTER TABLE sla_definitions
      ADD KEY idx_sla_definitions_org (organization_id, plan_id),
      ADD CONSTRAINT fk_sla_definitions_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;

CALL migration_429_org_scope_sla_definitions();
DROP PROCEDURE IF EXISTS migration_429_org_scope_sla_definitions;
