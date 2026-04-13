-- Migration: 149_contract_status_fsm_trigger
-- Description: Adds a BEFORE UPDATE trigger on contracts that enforces valid
--              status transitions as a finite state machine (FSM).
--
--              Allowed transitions:
--                pending   → active, cancelled
--                active    → expired, cancelled
--                expired   → (terminal — no further transitions)
--                cancelled → (terminal — no further transitions)
--
--              Business rule: contracts must follow a predictable lifecycle.
--              Allowing arbitrary transitions (e.g. cancelled → active, or
--              expired → pending) would corrupt billing, suspension, and
--              RADIUS provisioning logic.
--
--              The trigger raises SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$

CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    -- Only check when status actually changes
    IF NEW.status != OLD.status THEN
        -- Validate against allowed transitions
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
