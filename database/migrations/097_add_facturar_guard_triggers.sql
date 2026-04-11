-- Migration: 097_add_facturar_guard_triggers
-- Description: Adds BEFORE INSERT and BEFORE UPDATE triggers on contracts to
--              prevent setting facturar = TRUE for contracts whose client has
--              locale != 'MX'.
--
--              The facturar flag is MX-only: it controls whether the system
--              generates an individual CFDI for a contract's invoices.  Allowing
--              it on non-MX (global) clients is semantically invalid and could
--              cause application errors when the billing engine attempts to stamp
--              a CFDI for a client with no MX profile.

DELIMITER $$

CREATE TRIGGER trg_contracts_facturar_bi
BEFORE INSERT ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.facturar = TRUE THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.facturar can only be TRUE when the client has locale = ''MX''';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_contracts_facturar_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.facturar = TRUE AND (OLD.facturar = FALSE OR OLD.client_id != NEW.client_id) THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.facturar can only be TRUE when the client has locale = ''MX''';
        END IF;
    END IF;
END$$

DELIMITER ;
