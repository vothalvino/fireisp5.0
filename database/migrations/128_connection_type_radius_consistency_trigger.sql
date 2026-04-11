-- Migration: 128_connection_type_radius_consistency_trigger
-- Description: Adds a BEFORE UPDATE trigger on contracts that enforces the
--              RADIUS account requirement for PPPoE-based connection types.
--
--              Business rule: when a contract's connection_type is 'pppoe'
--              or 'pppoe_dual' AND the new status is 'active', at least one
--              corresponding row must exist in the radius table for that
--              contract.  Activating a PPPoE contract without a RADIUS
--              account would cause authentication failures for the subscriber
--              and is therefore rejected at the database level.
--
--              Why BEFORE UPDATE only (not BEFORE INSERT):
--                On INSERT the contract starts in 'pending' status, so RADIUS
--                accounts can be provisioned before activation.  The check is
--                only meaningful at the moment a contract transitions to
--                'active' — which happens via UPDATE.
--
--              The trigger raises SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_radius_consistency_bu$$

CREATE TRIGGER trg_contracts_radius_consistency_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_radius_count INT;

    -- Only enforce when activating a PPPoE or PPPoE-dual contract
    IF NEW.status = 'active'
       AND OLD.status != 'active'
       AND NEW.connection_type IN ('pppoe', 'pppoe_dual')
    THEN
        SELECT COUNT(*) INTO v_radius_count
        FROM   radius
        WHERE  contract_id = NEW.id;

        IF v_radius_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'PPPoE/PPPoE-dual contracts require at least one RADIUS account before activation';
        END IF;
    END IF;
END$$

DELIMITER ;
