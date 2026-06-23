-- =============================================================================
-- Rollback 362: Restore the terminal-state FSM (revert renew-from-terminal)
-- =============================================================================
-- Reverts migration 362 by restoring the migration-195 FSM trigger, in which
-- expired / cancelled / terminated are terminal (no transition back to active).
-- Note: any contract that was reactivated from a terminal state while migration
-- 362 was applied keeps its current status; this only reinstates the guard.
-- =============================================================================

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
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Invalid contract status transition';
        END IF;
    END IF;
END$$

DELIMITER ;
