-- =============================================================================
-- FireISP 5.0 — Rollback 223: Drop FreeRADIUS tables, radius auth_method,
--                              subscriber_certificates
-- =============================================================================
-- Reverses migration 223. Drop order respects FK dependencies:
--   subscriber_certificates references radius (RESTRICT) and clients (RESTRICT),
--   so it must be dropped before any attempt to drop those tables.
--   radcheck/radreply/radusergroup/radgroupcheck/radgroupreply are standalone.
-- Also removes the check_certificate_expiry scheduled task.
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name = 'check_certificate_expiry';

DROP TABLE IF EXISTS subscriber_certificates;
DROP TABLE IF EXISTS radgroupreply;
DROP TABLE IF EXISTS radgroupcheck;
DROP TABLE IF EXISTS radusergroup;
DROP TABLE IF EXISTS radreply;
DROP TABLE IF EXISTS radcheck;

-- MySQL does not support DROP COLUMN IF EXISTS — use a stored-procedure guard.
DROP PROCEDURE IF EXISTS rollback_223_drop_radius_auth_method;
DELIMITER //
CREATE PROCEDURE rollback_223_drop_radius_auth_method()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'auth_method'
  ) THEN
    ALTER TABLE radius DROP COLUMN auth_method;
  END IF;
END //
DELIMITER ;
CALL rollback_223_drop_radius_auth_method();
DROP PROCEDURE IF EXISTS rollback_223_drop_radius_auth_method;
