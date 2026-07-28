-- =============================================================================
-- Rollback 429 — drop sla_definitions.organization_id
-- =============================================================================
-- WARNING: reopens cross-tenant read AND write on SLA definitions the moment
-- SlaDefinition.hasOrgScope goes back to false — one ISP's uptime commitments,
-- response times and compensation rates become visible and editable to every
-- other tenant. Revert the code in the same step.
--
-- Index dropped EXPLICITLY and in its own guarded block: dropping a column does
-- not drop a multi-column index containing it, so the index can outlive the
-- column and a stale one makes the forward migration fail with ER_DUP_KEYNAME.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_429_org_scope_sla_definitions;
DELIMITER //
CREATE PROCEDURE rollback_429_org_scope_sla_definitions()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sla_definitions'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE sla_definitions DROP FOREIGN KEY fk_sla_definitions_org;
    ALTER TABLE sla_definitions DROP COLUMN organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sla_definitions'
      AND INDEX_NAME   = 'idx_sla_definitions_org'
  ) THEN
    ALTER TABLE sla_definitions DROP INDEX idx_sla_definitions_org;
  END IF;
END //
DELIMITER ;

CALL rollback_429_org_scope_sla_definitions();
DROP PROCEDURE IF EXISTS rollback_429_org_scope_sla_definitions;
