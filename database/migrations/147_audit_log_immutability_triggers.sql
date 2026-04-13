-- Migration: 147_audit_log_immutability_triggers
-- Description: Adds BEFORE UPDATE and BEFORE DELETE triggers on audit_logs
--              that prevent any modification or removal of audit records.
--
--              Business rule: audit logs are an append-only compliance trail.
--              Allowing updates or deletes would compromise forensic integrity
--              and violate regulatory requirements.  The only supported
--              removal path is the data-retention service which operates
--              outside normal DML (using administrative privileges or
--              temporarily dropping the trigger).
--
--              The triggers raise SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

-- -------------------------------------------------------------------------
-- 1. BEFORE UPDATE — block all modifications
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu$$

CREATE TRIGGER trg_audit_logs_immutable_bu
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be updated';
END$$

-- -------------------------------------------------------------------------
-- 2. BEFORE DELETE — block all deletions
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bd$$

CREATE TRIGGER trg_audit_logs_immutable_bd
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be deleted';
END$$

DELIMITER ;
