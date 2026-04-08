-- Migration: 036_create_warehouses_table
-- Description: Creates the warehouses table for tracking physical storage locations.
--              Supports multiple warehouses, each with optional aisle/column/shelf
--              location granularity defined at the stock level.

CREATE TABLE IF NOT EXISTS warehouses (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255)    NOT NULL COMMENT 'Warehouse name (e.g. Main Warehouse, Site B Storage)',
    address     VARCHAR(255)    NULL,
    city        VARCHAR(100)    NULL,
    state       VARCHAR(100)    NULL,
    country     VARCHAR(100)    NULL DEFAULT 'US',
    zip_code    VARCHAR(20)     NULL,
    latitude    DECIMAL(10, 8)  NULL,
    longitude   DECIMAL(11, 8)  NULL,
    notes       TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_warehouses_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
