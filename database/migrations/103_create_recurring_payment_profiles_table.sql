-- Migration: 103_create_recurring_payment_profiles_table
-- Description: Stored card / token per client for autopay (recurring charges).
--              Holds the gateway's customer or card token reference so that
--              the system can initiate charges without re-entering card details.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS recurring_payment_profiles (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    client_id           BIGINT UNSIGNED     NOT NULL                   COMMENT 'Client this autopay profile belongs to',
    payment_gateway_id  BIGINT UNSIGNED     NOT NULL                   COMMENT 'Gateway that issued the stored token',
    token_reference     VARCHAR(500)        NOT NULL                   COMMENT 'Gateway customer ID or card token',
    card_brand          VARCHAR(20)         NULL                       COMMENT 'Card network: visa, mastercard, amex, etc.',
    card_last_four      CHAR(4)             NULL                       COMMENT 'Last four digits of the card number',
    card_exp_month      TINYINT UNSIGNED    NULL                       COMMENT 'Card expiry month (1–12)',
    card_exp_year       SMALLINT UNSIGNED   NULL                       COMMENT 'Card expiry year (4-digit)',
    is_default          TINYINT(1)          NOT NULL DEFAULT 0         COMMENT 'TRUE = preferred profile for autopay',
    status              ENUM('active','expired','revoked')
                                            NOT NULL DEFAULT 'active'  COMMENT 'Profile lifecycle status',
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_recurring_profiles_client_id (client_id),
    KEY idx_recurring_profiles_gateway_id (payment_gateway_id),
    KEY idx_recurring_profiles_status (status),
    CONSTRAINT fk_recurring_profiles_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_recurring_profiles_gateway FOREIGN KEY (payment_gateway_id)
        REFERENCES payment_gateways (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
