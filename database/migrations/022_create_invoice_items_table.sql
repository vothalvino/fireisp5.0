-- Migration: 022_create_invoice_items_table
-- Description: Creates the invoice_items table for individual line items on invoices

CREATE TABLE IF NOT EXISTS invoice_items (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id  BIGINT UNSIGNED NOT NULL,
    description VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. plan name, one-time fee',
    quantity    DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price  DECIMAL(10, 2)  NOT NULL,
    total       DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_invoice_items_invoice_id (invoice_id),
    CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
