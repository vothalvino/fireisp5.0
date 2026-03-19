-- Migration: 012_create_payments_table
-- Description: Creates the payments table for recording client payments

CREATE TABLE IF NOT EXISTS payments (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED NOT NULL,
    invoice_id       BIGINT UNSIGNED NULL,
    amount           DECIMAL(10, 2)  NOT NULL,
    payment_date     DATE            NOT NULL,
    payment_method   ENUM('cash', 'check', 'credit_card', 'debit_card', 'bank_transfer', 'other')
                                     NOT NULL DEFAULT 'cash',
    reference_number VARCHAR(100)    NULL COMMENT 'Check number, transaction ID, etc.',
    notes            TEXT            NULL,
    recorded_by      BIGINT UNSIGNED NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_payments_client_id (client_id),
    KEY idx_payments_invoice_id (invoice_id),
    KEY idx_payments_payment_date (payment_date),
    CONSTRAINT fk_payments_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
