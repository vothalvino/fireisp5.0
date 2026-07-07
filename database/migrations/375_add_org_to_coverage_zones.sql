-- =============================================================================
-- Migration 375 — Add organization_id to coverage_zones so the coverage-zone
-- service can tenant-scope its rows.
-- =============================================================================
-- The coverage-zone service (src/services/coverageZoneService.js) and every
-- /coverage-zones endpoint were written against an organization_id column that
-- coverage_zones (created in migration 062) never had:
--
--   * The list/get/restore SELECTs filter `WHERE organization_id = ?`.
--   * createZone() INSERTs organization_id.
--   * updateZone()/deleteZone()/restoreZone() scope their writes by
--     `WHERE id = ? AND organization_id = ?`.
--
-- Because the column did not exist, MySQL rejected every one of those queries
-- with "Unknown column 'organization_id'", so ALL /coverage-zones endpoints
-- 500'd. Unlike inventory_stock or device_config_backups (which reach their
-- tenant through a parent row), coverage_zones has no other tenancy path — a
-- zone's only parent is service_area, which is not itself org-scoped — so the
-- table genuinely needs its own organization_id to be tenant-safe.
--
-- This migration adds organization_id (nullable — NULL = single-tenant
-- deployment, matching every other org-scoped table in the schema), an index
-- the list/get queries can use, and an FK to organizations that nulls the
-- reference if the org is deleted.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_375_add_org_to_coverage_zones;
DELIMITER //
CREATE PROCEDURE migration_375_add_org_to_coverage_zones()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'coverage_zones'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE coverage_zones
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Tenant organization this coverage zone belongs to; NULL = single-tenant deployment (migration 375)'
          AFTER id,
      ADD KEY idx_coverage_zones_organization_id (organization_id),
      ADD CONSTRAINT fk_coverage_zones_organization FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_375_add_org_to_coverage_zones();
DROP PROCEDURE IF EXISTS migration_375_add_org_to_coverage_zones;
