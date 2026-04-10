-- Migration: 045_create_client_balance_ledger_table
-- Description: Running account balance per client (prepaid / postpaid tracking).
--              Each row records a debit (invoice, usage deduction) or credit
--              (payment, top-up, credit note, adjustment) and maintains a
--              running balance per client. Supports both prepaid (balance = credit
--              remaining) and postpaid (balance = amount owed) billing models.

CREATE TABLE IF NOT EXISTS client_balance_ledger (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED  NOT NULL,
    balance_type    ENUM('prepaid', 'postpaid') NOT NULL DEFAULT 'postpaid'
                        COMMENT 'prepaid = client pays in advance (positive balance = available credit); postpaid = client pays after usage (positive balance = amount owed)',
    entry_type      ENUM('invoice', 'payment', 'credit_note', 'adjustment', 'topup', 'usage_deduction') NOT NULL
                        COMMENT 'invoice/usage_deduction = debit entries; payment/topup/credit_note/adjustment = credit entries',
    reference_id    BIGINT UNSIGNED  NULL     COMMENT 'Polymorphic ID of the invoice, payment, credit_note, or related entity',
    description     VARCHAR(255)     NULL,
    debit           DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount charged (increases balance owed / decreases prepaid credit)',
    credit          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount credited (decreases balance owed / increases prepaid credit)',
    running_balance DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Client account balance after this entry',
    entry_date      DATE             NOT NULL,
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'User who created this entry; NULL = system',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ledger_organization_id (organization_id),
    KEY idx_ledger_client_id (client_id),
    KEY idx_ledger_client_balance_date (client_id, balance_type, entry_date),
    KEY idx_ledger_entry_date (entry_date),
    KEY idx_ledger_entry_type (entry_type),
    KEY idx_ledger_balance_type (balance_type),
    CONSTRAINT fk_ledger_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ledger_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ledger_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
