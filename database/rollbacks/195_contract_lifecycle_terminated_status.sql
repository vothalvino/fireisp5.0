-- =============================================================================
-- FireISP 5.0 — Rollback 195: Revert terminated status + FSM trigger
-- =============================================================================
-- Reverses migration 195.
-- IMPORTANT: If any contracts have status = 'terminated' this rollback will
-- fail because MySQL cannot remove an ENUM value while rows reference it.
-- Update or delete those rows before rolling back.
-- =============================================================================

-- Restore the original FSM trigger first (before the ENUM shrinks).
DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$

CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    IF NEW.status != OLD.status THEN
        IF NOT (
               (OLD.status = 'pending'   AND NEW.status IN ('active', 'cancelled'))
            OR (OLD.status = 'active'    AND NEW.status IN ('expired', 'cancelled'))
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Invalid contract status transition';
        END IF;
    END IF;
END$$

DELIMITER ;

-- Remove the 'terminated' value from the ENUM.
ALTER TABLE contracts
  MODIFY COLUMN status
    ENUM('pending','active','suspended','expired','cancelled')
    NOT NULL DEFAULT 'pending';
