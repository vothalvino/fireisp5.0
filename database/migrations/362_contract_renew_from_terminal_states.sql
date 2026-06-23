-- =============================================================================
-- Migration 362: Allow renewing (reinstating) contracts from terminal states
-- =============================================================================
-- Bug: POST /contracts/:id/renew (and the RenewModal) could not reactivate a
-- cancelled, expired, or terminated contract. The route accepted
-- suspended/expired/cancelled, but the contract-status FSM trigger
-- (trg_contracts_status_fsm_bu, migrations 149/195) treated expired, cancelled,
-- and terminated as TERMINAL. So the renew's `UPDATE ... SET status='active'`
-- was rejected at the database with "Invalid contract status transition" —
-- only `suspended -> active` actually worked. (A dedicated route cannot bypass
-- a BEFORE UPDATE trigger; the trigger fires on every UPDATE.)
--
-- Fix: extend the FSM to permit reinstatement (renew) from the terminal states:
--       expired    -> active
--       cancelled  -> active
--       terminated -> active
--
-- Full updated FSM:
--   pending    -> active, cancelled
--   active     -> expired, cancelled, suspended, terminated
--   suspended  -> active, cancelled, terminated
--   expired    -> active            (renew)
--   cancelled  -> active            (renew)
--   terminated -> active            (renew / reinstate)
--
-- No ENUM change — every status value already exists (added in migration 195).
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
         OR (OLD.status IN ('expired', 'cancelled', 'terminated') AND NEW.status = 'active')
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Invalid contract status transition';
        END IF;
    END IF;
END$$

DELIMITER ;
