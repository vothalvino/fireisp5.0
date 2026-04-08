-- Migration: 039_create_inventory_transactions_table
-- Description: Creates the inventory_transactions table — an immutable log of every
--              stock movement. Tracks receiving, job assignments, client sales,
--              warehouse transfers, and manual adjustments.

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    stock_id          BIGINT UNSIGNED NOT NULL COMMENT 'inventory_stock row affected',
    transaction_type  ENUM(
                          'receive',
                          'assign_to_job',
                          'sell_to_client',
                          'transfer_out',
                          'transfer_in',
                          'return',
                          'adjustment'
                      ) NOT NULL
                          COMMENT 'receive=new stock in, assign_to_job=used on a work order, sell_to_client=sold directly to client, transfer_out/in=warehouse-to-warehouse move, return=returned from job/client, adjustment=manual correction',
    quantity          INT             NOT NULL COMMENT 'Positive for inbound, negative for outbound',
    unit_price        DECIMAL(10, 2)  NULL COMMENT 'Price per unit at time of transaction (for sales/receives)',

    -- Optional context references
    job_id            BIGINT UNSIGNED NULL COMMENT 'Related job (assign_to_job / return)',
    client_id         BIGINT UNSIGNED NULL COMMENT 'Related client (sell_to_client)',
    invoice_id        BIGINT UNSIGNED NULL COMMENT 'Invoice tied to a client sale, if any',
    destination_stock_id BIGINT UNSIGNED NULL COMMENT 'Target inventory_stock row for transfers',

    performed_by      BIGINT UNSIGNED NULL COMMENT 'User who performed the transaction',
    reference         VARCHAR(255)    NULL COMMENT 'External reference (PO number, receipt, etc.)',
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_inv_txn_stock_id (stock_id),
    KEY idx_inv_txn_type (transaction_type),
    KEY idx_inv_txn_job_id (job_id),
    KEY idx_inv_txn_client_id (client_id),
    KEY idx_inv_txn_invoice_id (invoice_id),
    KEY idx_inv_txn_destination_stock_id (destination_stock_id),
    KEY idx_inv_txn_performed_by (performed_by),
    KEY idx_inv_txn_created_at (created_at),
    CONSTRAINT fk_inv_txn_stock FOREIGN KEY (stock_id)
        REFERENCES inventory_stock (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_job FOREIGN KEY (job_id)
        REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_destination_stock FOREIGN KEY (destination_stock_id)
        REFERENCES inventory_stock (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_performed_by FOREIGN KEY (performed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
