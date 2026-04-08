-- Migration: 041_create_credit_note_items_table
-- Description: Creates the credit_note_items table for individual line items on
--              credit notes (same pattern as invoice_items).

CREATE TABLE IF NOT EXISTS credit_note_items (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    credit_note_id  BIGINT UNSIGNED NOT NULL,
    description     VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. returned router, service outage compensation',
    quantity        DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price      DECIMAL(10, 2)  NOT NULL,
    total           DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_credit_note_items_credit_note_id (credit_note_id),
    CONSTRAINT fk_credit_note_items_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
