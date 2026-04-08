-- Migration: 035_create_inventory_items_table
-- Description: Creates the inventory_items table — a catalog of spare equipment
--              and materials that can be stocked in warehouses (antennas, cables,
--              routers, ONUs, connectors, etc.).

CREATE TABLE IF NOT EXISTS inventory_items (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sku             VARCHAR(100)    NULL COMMENT 'Stock-keeping unit / internal part number',
    name            VARCHAR(255)    NOT NULL COMMENT 'Item name (e.g. MikroTik hAP ac³)',
    category        ENUM(
                        'antenna',
                        'cable',
                        'router',
                        'switch',
                        'onu',
                        'olt',
                        'cpe',
                        'connector',
                        'power_supply',
                        'enclosure',
                        'tool',
                        'other'
                    ) NOT NULL DEFAULT 'other'
                        COMMENT 'Item category for filtering and reporting',
    manufacturer    VARCHAR(100)    NULL,
    model           VARCHAR(100)    NULL,
    description     TEXT            NULL,
    unit            VARCHAR(30)     NOT NULL DEFAULT 'unit'
                        COMMENT 'Unit of measure (unit, meter, roll, box, pair, etc.)',
    unit_cost       DECIMAL(10, 2)  NULL COMMENT 'Default purchase cost per unit',
    sale_price      DECIMAL(10, 2)  NULL COMMENT 'Default sale price per unit when sold to a client',
    reorder_level   INT UNSIGNED    NULL COMMENT 'Minimum total stock before a reorder alert is triggered',
    notes           TEXT            NULL,
    status          ENUM('active', 'discontinued') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_items_sku (sku),
    KEY idx_inventory_items_category (category),
    KEY idx_inventory_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
