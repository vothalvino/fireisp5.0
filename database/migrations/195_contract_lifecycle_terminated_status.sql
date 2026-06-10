-- =============================================================================
-- Migration 195: Contract lifecycle — terminated status + updated FSM trigger
-- =============================================================================
-- Fixes isp-platform-features.md §1.2 "Contract lifecycle: create, renew,
-- modify, suspend, terminate":
--
--  1. Adds `terminated` to the contracts.status ENUM. The existing ENUM was
--     ('active', 'expired', 'cancelled', 'pending', 'suspended'); we extend it
--     to include 'terminated' as a distinct terminal state (permanent end of
--     service, e.g. after prolonged non-payment or by regulatory order).
--
--  2. Replaces the FSM trigger (migration 149) with an updated version that
--     allows the following additional transitions:
--       active    → terminated
--       suspended → terminated
--
--     Full updated FSM:
--       pending    → active, cancelled
--       active     → expired, cancelled, suspended, terminated
--       suspended  → active (reinstatement/renew), cancelled, terminated
--       expired    → (terminal — no further transitions)
--       cancelled  → (terminal — no further transitions)
--       terminated → (terminal — no further transitions)
--
--     Note: suspended → active (renew) was not allowed by the old trigger
--     and caused the RenewModal PATCH to fail. This migration fixes that too.
-- =============================================================================

-- Step 1: Extend the ENUM to include 'terminated'.
-- MySQL requires re-specifying the full ENUM on ALTER COLUMN MODIFY.
ALTER TABLE contracts
  MODIFY COLUMN status
    ENUM('pending','active','suspended','expired','cancelled','terminated')
    NOT NULL DEFAULT 'pending';

-- Step 2: Replace the FSM trigger with the updated transition table.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$

CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    -- Only enforce when status actually changes.
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
