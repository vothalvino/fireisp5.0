-- =============================================================================
-- Rollback 444: drop the install-operator flag
-- =============================================================================
-- Reverting this restores the old behaviour, in which every account with
-- users.role='admin' — i.e. EVERY organisation's admin — passes the
-- install-operator checks. Only roll back on a single-organisation install,
-- where those are the same person.

DROP PROCEDURE IF EXISTS rollback_444_install_operator_flag;
DELIMITER //
CREATE PROCEDURE rollback_444_install_operator_flag()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'is_install_operator'
  ) THEN
    ALTER TABLE users DROP COLUMN is_install_operator;
  END IF;
END //
DELIMITER ;

CALL rollback_444_install_operator_flag();
DROP PROCEDURE IF EXISTS rollback_444_install_operator_flag;
