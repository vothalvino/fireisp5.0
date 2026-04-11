-- Migration: 112_create_contract_addons_table
-- Description: Add-ons attached to a specific client contract.
--              References plan_addons for the catalog definition and stores
--              the contracted quantity, negotiated unit price, validity window,
--              and status for lifecycle management.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS contract_addons (
    id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id    BIGINT UNSIGNED  NOT NULL                    COMMENT 'Contract this add-on is assigned to',
    plan_addon_id  BIGINT UNSIGNED  NOT NULL                    COMMENT 'Add-on catalog entry being assigned',
    quantity       INT UNSIGNED     NOT NULL DEFAULT 1          COMMENT 'Number of units contracted',
    unit_price     DECIMAL(10, 2)   NOT NULL                    COMMENT 'Agreed per-unit price (may differ from catalog price)',
    start_date     DATE             NOT NULL                    COMMENT 'Date from which the add-on is active on this contract',
    end_date       DATE             NULL                        COMMENT 'Date the add-on expires; NULL = no fixed end date',
    notes          TEXT             NULL                        COMMENT 'Free-text notes about this add-on assignment',
    status         ENUM('active','cancelled','expired')
                                    NOT NULL DEFAULT 'active'   COMMENT 'Lifecycle status of the add-on on this contract',
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contract_addons_contract_id (contract_id),
    KEY idx_contract_addons_plan_addon_id (plan_addon_id),
    KEY idx_contract_addons_status (status),
    CONSTRAINT fk_contract_addons_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contract_addons_plan_addon FOREIGN KEY (plan_addon_id)
        REFERENCES plan_addons (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
