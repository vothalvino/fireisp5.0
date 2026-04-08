-- Migration: 045_create_client_balance_ledger_table
-- Description: Running client balance / account statement ledger. Each row
--              records a debit (invoice) or credit (payment, credit note,
--              adjustment) and maintains a running balance per client.

CREATE TABLE IF NOT EXISTS client_balance_ledger (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    client_id       BIGINT UNSIGNED  NOT NULL,
    entry_type      ENUM('invoice', 'payment', 'credit_note', 'adjustment') NOT NULL,
    reference_id    BIGINT UNSIGNED  NULL     COMMENT 'Polymorphic ID of the invoice, payment, or credit_note',
    description     VARCHAR(255)     NULL,
    debit           DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount charged (increases balance owed)',
    credit          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount credited (decreases balance owed)',
    running_balance DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Client account balance after this entry',
    entry_date      DATE             NOT NULL,
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'User who created this entry; NULL = system',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ledger_client_id (client_id),
    KEY idx_ledger_entry_date (entry_date),
    KEY idx_ledger_entry_type (entry_type),
    CONSTRAINT fk_ledger_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ledger_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
