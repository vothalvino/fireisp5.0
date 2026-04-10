-- Migration: 078_add_mx_template_to_contracts
-- Description: Links each contract to an IFT/CRT-registered Carta de Adhesión
--              template (created in migration 077).
--
--              NULL = global client / no registered template required.
--              Populated = MX client; the app can enforce that a registered
--              template is selected before the contract is activated.

-- Disable FK checks: contract_templates_mx is created in migration 077.
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE contracts
    ADD COLUMN contract_template_mx_id BIGINT UNSIGNED NULL
        COMMENT 'IFT/CRT-registered Carta de Adhesión template used for this contract; NULL for global clients'
        AFTER connection_type;

ALTER TABLE contracts
    ADD KEY idx_contracts_contract_template_mx_id (contract_template_mx_id);

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_contract_template_mx
        FOREIGN KEY (contract_template_mx_id)
        REFERENCES contract_templates_mx (id)
        ON DELETE SET NULL
        ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
