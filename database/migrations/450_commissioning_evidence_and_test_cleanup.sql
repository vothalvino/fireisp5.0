-- =============================================================================
-- Migration 450 — bound commissioning evidence + durable test-window cleanup
-- =============================================================================
-- A technician speed row is activation evidence only when it is bound to the
-- exact installation work order that produced it. Generic /speed-tests writes
-- deliberately leave work_order_id NULL.
--
-- RouterOS cleanup is external network I/O and can fail after the database line
-- is disabled. test_window_cleanup_pending keeps that failure durable: the
-- expiry sweep retries it across contract cancellation, type changes, and soft
-- deletion, while permanent activation remains blocked.
--
-- first_activated_at distinguishes service that has crossed the activation
-- boundary (or is a qualifying non-cancelled legacy service state) from new
-- unactivated records.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_450_commissioning_evidence;
DELIMITER //
CREATE PROCEDURE migration_450_commissioning_evidence()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
       AND COLUMN_NAME = 'work_order_id'
  ) THEN
    ALTER TABLE speed_tests
      ADD COLUMN work_order_id BIGINT UNSIGNED NULL
        COMMENT 'Installation work order that produced trusted commissioning evidence; NULL for generic/SLA tests (migration 450)'
        AFTER contract_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
       AND INDEX_NAME = 'idx_speed_tests_work_order'
  ) THEN
    ALTER TABLE speed_tests
      ADD KEY idx_speed_tests_work_order (work_order_id, tested_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
       AND CONSTRAINT_NAME = 'fk_speed_tests_work_order'
  ) THEN
    ALTER TABLE speed_tests
      ADD CONSTRAINT fk_speed_tests_work_order FOREIGN KEY (work_order_id)
        REFERENCES work_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND COLUMN_NAME = 'test_window_cleanup_pending'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN test_window_cleanup_pending TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 while temporary or legacy pending credentials still need external NAS/session cleanup; blocks activation and is retried by sweep (migration 450)'
        AFTER test_window_expires_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND COLUMN_NAME = 'test_window_cleanup_attempted_at'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN test_window_cleanup_attempted_at DATETIME(6) NULL
        COMMENT 'Last external cleanup attempt; makes sweep batches fair and retryable (migration 450)'
        AFTER test_window_cleanup_pending;
  END IF;

  -- A partially-run earlier draft may have created the two-column version of
  -- this index. Replace it before adding the durable retry-order column.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND INDEX_NAME = 'idx_contracts_test_cleanup'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND INDEX_NAME = 'idx_contracts_test_cleanup'
       AND COLUMN_NAME = 'test_window_cleanup_attempted_at'
  ) THEN
    ALTER TABLE contracts DROP INDEX idx_contracts_test_cleanup;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND INDEX_NAME = 'idx_contracts_test_cleanup'
  ) THEN
    ALTER TABLE contracts
      ADD KEY idx_contracts_test_cleanup
        (test_window_cleanup_pending, test_window_cleanup_attempted_at, test_window_expires_at);
  END IF;

  -- Migration 448 deliberately grandfathered already-pending PPPoE accounts,
  -- leaving their pre-feature RADIUS/local-secret access active with no test
  -- bound. Reconcile that state fail-closed. Only rows with evidence of
  -- materialized authentication are marked for external retry; a genuinely
  -- empty pending contract (no active account, NAS, or rad* rows) is not
  -- poisoned with a cleanup blocker. A NULL expiry is intentional: unlike a
  -- real bounded window, an unconfirmed legacy session never becomes safe
  -- merely because an artificial timestamp passes.
  UPDATE contracts c
     SET c.test_window_cleanup_pending = 1,
         c.test_window_cleanup_attempted_at = NULL
   WHERE c.status = 'pending'
     AND c.connection_type IN ('pppoe', 'pppoe_dual')
     AND EXISTS (
       SELECT 1
         FROM radius r
        WHERE r.contract_id = c.id
          AND (
               (r.deleted_at IS NULL AND r.status <> 'inactive')
            OR r.nas_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = r.username)
          )
     );

  DELETE rc FROM radcheck rc
  JOIN radius r ON r.username = rc.username
  JOIN contracts c ON c.id = r.contract_id
  WHERE c.status = 'pending'
    AND c.connection_type IN ('pppoe', 'pppoe_dual');

  DELETE rr FROM radreply rr
  JOIN radius r ON r.username = rr.username
  JOIN contracts c ON c.id = r.contract_id
  WHERE c.status = 'pending'
    AND c.connection_type IN ('pppoe', 'pppoe_dual');

  DELETE rug FROM radusergroup rug
  JOIN radius r ON r.username = rug.username
  JOIN contracts c ON c.id = r.contract_id
  WHERE c.status = 'pending'
    AND c.connection_type IN ('pppoe', 'pppoe_dual');

  UPDATE radius r
  JOIN contracts c ON c.id = r.contract_id
     SET r.status = 'inactive'
   WHERE c.status = 'pending'
     AND c.connection_type IN ('pppoe', 'pppoe_dual')
     AND r.deleted_at IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
       AND COLUMN_NAME = 'first_activated_at'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN first_activated_at DATETIME NULL
        COMMENT 'First successful activation or grandfathered non-cancelled legacy service; NULL means no activation has been recorded (migration 450)'
        AFTER status;
  END IF;

  -- Active/suspended/expired/terminated legacy rows have crossed the service
  -- boundary and are safe to grandfather. Cancelled is deliberately excluded:
  -- without durable proof it may be an abandoned never-activated install that
  -- must re-enter pending commissioning. This remains safe on migration reruns.
  UPDATE contracts
     SET first_activated_at = COALESCE(updated_at, created_at, NOW())
   WHERE first_activated_at IS NULL
     AND status IN ('active', 'suspended', 'expired', 'terminated');
END //
DELIMITER ;

CALL migration_450_commissioning_evidence();
DROP PROCEDURE IF EXISTS migration_450_commissioning_evidence;

-- Application code consults first_activated_at before choosing pending versus
-- direct-active renewal. The trigger permits both sanctioned paths.
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
        OR (OLD.status = 'suspended'  AND NEW.status IN ('pending', 'active', 'cancelled', 'terminated'))
        OR (OLD.status IN ('expired', 'cancelled', 'terminated') AND NEW.status IN ('pending', 'active'))
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Invalid contract status transition';
    END IF;
  END IF;
END$$

DELIMITER ;
