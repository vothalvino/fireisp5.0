-- =============================================================================
-- Migration 374 — Repair the audit_logs table so the audit trail records
-- =============================================================================
-- The audit service (src/services/auditLog.js) and the read/export routes
-- (src/routes/auditLogs.js) were written against columns audit_logs never had:
--
--   * organization_id — the read/export queries filter on it, and every write
--     tried to INSERT it. The column did not exist, so the INSERT threw and was
--     swallowed by the service's try/catch: NO audit rows were ever written,
--     and the /audit-logs page 500'd. For an ISP that must retain an audit
--     trail for regulator/PROFECO evidence, that is a silent compliance hole.
--
--   * action was a 7-value ENUM ('create','update','delete','login','logout',
--     'export','other'), but callers emit 20+ verbs (partial_update,
--     soft_delete, terminate, renew, void, merge, convert, disconnect, ...).
--     Even with the right column names, most writes would fail the ENUM. Widen
--     it to VARCHAR so the vocabulary can grow without a schema change.
--
-- This migration adds organization_id (nullable — system actions have none;
-- FK to organizations) with an index the read route can use, and widens action.
-- The service/route are updated in the same PR to write entity_type/entity_id
-- (the table's real affected-record columns) instead of the nonexistent
-- table_name/record_id.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_374_fix_audit_logs;
DELIMITER //
CREATE PROCEDURE migration_374_fix_audit_logs()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE audit_logs
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Org context of the audited action; NULL for system actions (migration 374)'
          AFTER user_id,
      ADD KEY idx_audit_logs_org (organization_id, created_at DESC),
      ADD CONSTRAINT fk_audit_logs_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'audit_logs'
      AND COLUMN_NAME  = 'action'
      AND DATA_TYPE    = 'enum'
  ) THEN
    ALTER TABLE audit_logs
      MODIFY COLUMN action VARCHAR(40) NOT NULL
          COMMENT 'Action verb, e.g. create/update/partial_update/soft_delete/terminate/void (migration 374 widened from ENUM)';
  END IF;
END //
DELIMITER ;
CALL migration_374_fix_audit_logs();
DROP PROCEDURE IF EXISTS migration_374_fix_audit_logs;
