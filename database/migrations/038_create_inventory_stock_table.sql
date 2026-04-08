-- Migration: 038_create_inventory_stock_table
-- Description: Creates the inventory_stock table — current stock levels per item
--              per warehouse location. Each row represents a unique combination
--              of item + warehouse + aisle/column/shelf.

CREATE TABLE IF NOT EXISTS inventory_stock (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_id       BIGINT UNSIGNED NOT NULL,
    warehouse_id  BIGINT UNSIGNED NOT NULL,
    aisle         VARCHAR(20)     NULL COMMENT 'Aisle identifier within the warehouse',
    col           VARCHAR(20)     NULL COMMENT 'Column identifier within the aisle',
    shelf         VARCHAR(20)     NULL COMMENT 'Shelf identifier within the column',
    quantity      INT             NOT NULL DEFAULT 0 COMMENT 'Current quantity on hand',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_stock_location (item_id, warehouse_id, aisle, col, shelf),
    KEY idx_inventory_stock_warehouse_id (warehouse_id),
    KEY idx_inventory_stock_item_id (item_id),
    CONSTRAINT fk_inventory_stock_item FOREIGN KEY (item_id)
        REFERENCES inventory_items (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inventory_stock_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
