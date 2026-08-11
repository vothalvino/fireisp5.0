-- Rollback for migration 450 — bound evidence, cleanup marker, activation marker
DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$
CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
  IF NEW.status != OLD.status THEN
    IF NOT (
           (OLD.status = 'pending'    AND NEW.status IN ('active', 'cancelled'))
        OR (OLD.status = 'active'     AND NEW.status IN ('expired', 'cancelled', 'suspended', 'terminated'))
        OR (OLD.status = 'suspended'  AND NEW.status IN ('active', 'cancelled', 'terminated'))
        OR (OLD.status IN ('expired', 'cancelled', 'terminated') AND NEW.status = 'active')
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Invalid contract status transition';
    END IF;
  END IF;
END$$

DELIMITER ;

ALTER TABLE speed_tests
  DROP FOREIGN KEY fk_speed_tests_work_order,
  DROP INDEX idx_speed_tests_work_order,
  DROP COLUMN work_order_id;

ALTER TABLE contracts
  DROP INDEX idx_contracts_test_cleanup,
  DROP COLUMN test_window_cleanup_pending,
  DROP COLUMN test_window_cleanup_attempted_at,
  DROP COLUMN first_activated_at;
