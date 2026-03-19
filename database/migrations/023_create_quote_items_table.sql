-- Migration: 023_create_quote_items_table
-- Description: Creates the quote_items table for individual line items on quotes

CREATE TABLE IF NOT EXISTS quote_items (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_id    BIGINT UNSIGNED NOT NULL,
    description VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. service, installation fee',
    quantity    DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price  DECIMAL(10, 2)  NOT NULL,
    total       DECIMAL(10, 2)  NOT NULL COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_quote_items_quote_id (quote_id),
    CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id)
        REFERENCES quotes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
