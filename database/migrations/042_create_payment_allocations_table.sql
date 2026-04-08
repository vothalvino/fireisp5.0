-- Migration: 042_create_payment_allocations_table
-- Description: Creates the payment_allocations junction table to support split
--              payments — one payment applied across multiple invoices.
--              The existing payments.invoice_id column is kept for backward
--              compatibility and serves as a shortcut for simple single-invoice
--              payments.

CREATE TABLE IF NOT EXISTS payment_allocations (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    payment_id  BIGINT UNSIGNED NOT NULL  COMMENT 'Payment being allocated',
    invoice_id  BIGINT UNSIGNED NOT NULL  COMMENT 'Invoice receiving this portion of the payment',
    amount      DECIMAL(10, 2)  NOT NULL  COMMENT 'Portion of the payment applied to this invoice',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_allocations_payment_invoice (payment_id, invoice_id),
    KEY idx_payment_allocations_invoice_id (invoice_id),
    CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_allocations_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
