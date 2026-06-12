-- =============================================================================
-- Migration 305: Inventory & Asset Management core tables — §14
-- =============================================================================
-- New tables: vendors, purchase_orders, purchase_order_items,
--             assets, asset_assignments, rma_requests
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: vendors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    name            VARCHAR(255) NOT NULL,
    contact_name    VARCHAR(100) NULL,
    email           VARCHAR(255) NULL,
    phone           VARCHAR(50)  NULL,
    website         VARCHAR(255) NULL,
    address         TEXT         NULL,
    tax_id          VARCHAR(100) NULL,
    payment_terms   VARCHAR(100) NULL COMMENT 'e.g. Net 30',
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    notes           TEXT NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_vendors_org (organization_id),
    KEY idx_vendors_status (status),
    KEY idx_vendors_deleted_at (deleted_at),
    CONSTRAINT fk_vendors_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: purchase_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    vendor_id       BIGINT UNSIGNED NULL,
    po_number       VARCHAR(100) NOT NULL,
    status          ENUM('draft','sent','partial','received','cancelled') NOT NULL DEFAULT 'draft',
    order_date      DATE NULL,
    expected_date   DATE NULL,
    received_date   DATE NULL,
    warehouse_id    BIGINT UNSIGNED NULL COMMENT 'Default destination warehouse',
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    reference       VARCHAR(255) NULL COMMENT 'External invoice/reference number',
    notes           TEXT NULL,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_po_org (organization_id),
    KEY idx_po_vendor (vendor_id),
    KEY idx_po_status (status),
    KEY idx_po_number (po_number),
    KEY idx_po_deleted_at (deleted_at),
    CONSTRAINT fk_po_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_po_vendor FOREIGN KEY (vendor_id)
        REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_po_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES warehouses (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_po_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: purchase_order_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    po_id             BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NULL,
    description       VARCHAR(255) NOT NULL,
    quantity_ordered  INT UNSIGNED NOT NULL DEFAULT 1,
    quantity_received INT UNSIGNED NOT NULL DEFAULT 0,
    unit_cost         DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    total_cost        DECIMAL(14,4) GENERATED ALWAYS AS (quantity_ordered * unit_cost) STORED,
    notes             TEXT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_poi_po (po_id),
    KEY idx_poi_item (inventory_item_id),
    CONSTRAINT fk_poi_po FOREIGN KEY (po_id)
        REFERENCES purchase_orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_poi_item FOREIGN KEY (inventory_item_id)
        REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    asset_tag           VARCHAR(100) NULL COMMENT 'Human-readable asset tag e.g. AST-001',
    barcode             VARCHAR(200) NULL COMMENT 'Barcode / QR code payload',
    name                VARCHAR(255) NOT NULL,
    category            ENUM('router','switch','onu','olt','sfp','cable','antenna','cpe','server','tool','other') NOT NULL DEFAULT 'other',
    manufacturer        VARCHAR(100) NULL,
    model               VARCHAR(100) NULL,
    serial_number       VARCHAR(100) NULL,
    inventory_item_id   BIGINT UNSIGNED NULL COMMENT 'Link to catalog item',
    warehouse_id        BIGINT UNSIGNED NULL COMMENT 'Current storage location',
    vendor_id           BIGINT UNSIGNED NULL COMMENT 'Vendor/supplier this was purchased from',
    purchase_order_id   BIGINT UNSIGNED NULL COMMENT 'PO this asset was received from',
    lifecycle_status    ENUM('in_stock','assigned','deployed','maintenance','rma','disposed') NOT NULL DEFAULT 'in_stock',
    purchase_date       DATE NULL,
    purchase_cost       DECIMAL(12,2) NULL,
    warranty_expires_at DATE NULL,
    warranty_notes      TEXT NULL,
    depreciation_method ENUM('straight_line','declining_balance','none') NOT NULL DEFAULT 'none',
    useful_life_months  SMALLINT UNSIGNED NULL DEFAULT 60,
    salvage_value       DECIMAL(12,2) NULL DEFAULT 0.00,
    disposed_at         DATETIME NULL,
    disposal_reason     ENUM('end_of_life','damaged','lost','stolen','sold','other') NULL,
    disposal_notes      TEXT NULL,
    notes               TEXT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_assets_org (organization_id),
    KEY idx_assets_serial (serial_number),
    KEY idx_assets_tag (asset_tag),
    KEY idx_assets_barcode (barcode),
    KEY idx_assets_status (lifecycle_status),
    KEY idx_assets_warranty (warranty_expires_at),
    KEY idx_assets_deleted_at (deleted_at),
    CONSTRAINT fk_assets_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assets_item FOREIGN KEY (inventory_item_id)
        REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assets_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES warehouses (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assets_vendor FOREIGN KEY (vendor_id)
        REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assets_po FOREIGN KEY (purchase_order_id)
        REFERENCES purchase_orders (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: asset_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_assignments (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    asset_id        BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    client_id       BIGINT UNSIGNED NULL COMMENT 'Customer this asset is assigned to',
    device_id       BIGINT UNSIGNED NULL COMMENT 'Network device (OLT/switch) this asset is plugged into',
    port_name       VARCHAR(100) NULL COMMENT 'Port identifier on device (e.g. 0/0/1)',
    assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    returned_at     DATETIME NULL COMMENT 'When asset was unassigned',
    assigned_by     BIGINT UNSIGNED NULL,
    returned_by     BIGINT UNSIGNED NULL,
    notes           TEXT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_asset_assign_asset (asset_id),
    KEY idx_asset_assign_client (client_id),
    KEY idx_asset_assign_device (device_id),
    KEY idx_asset_assign_org (organization_id),
    CONSTRAINT fk_aa_asset FOREIGN KEY (asset_id)
        REFERENCES assets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_aa_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_aa_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_aa_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_aa_assigned_by FOREIGN KEY (assigned_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_aa_returned_by FOREIGN KEY (returned_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: rma_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rma_requests (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    rma_number      VARCHAR(100) NOT NULL,
    asset_id        BIGINT UNSIGNED NULL,
    vendor_id       BIGINT UNSIGNED NULL,
    status          ENUM('open','shipped','received','replacement_sent','closed','denied') NOT NULL DEFAULT 'open',
    reason          ENUM('defective','wrong_item','damaged_in_transit','warranty_claim','other') NOT NULL DEFAULT 'other',
    description     TEXT NULL,
    shipped_at      DATETIME NULL,
    received_at     DATETIME NULL,
    resolved_at     DATETIME NULL,
    replacement_asset_id BIGINT UNSIGNED NULL COMMENT 'New asset sent as replacement',
    created_by      BIGINT UNSIGNED NULL,
    notes           TEXT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_rma_org (organization_id),
    KEY idx_rma_asset (asset_id),
    KEY idx_rma_vendor (vendor_id),
    KEY idx_rma_status (status),
    KEY idx_rma_number (rma_number),
    KEY idx_rma_deleted_at (deleted_at),
    CONSTRAINT fk_rma_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rma_asset FOREIGN KEY (asset_id)
        REFERENCES assets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rma_vendor FOREIGN KEY (vendor_id)
        REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rma_replacement FOREIGN KEY (replacement_asset_id)
        REFERENCES assets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rma_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
