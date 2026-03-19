-- Migration: 006_create_contracts_table
-- Description: Creates the contracts table linking clients to service plans

CREATE TABLE IF NOT EXISTS contracts (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id      BIGINT UNSIGNED NOT NULL,
    plan_id        BIGINT UNSIGNED NOT NULL,
    site_id        BIGINT UNSIGNED NULL,
    start_date     DATE            NOT NULL,
    end_date       DATE            NULL,
    billing_cycle  ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NULL COMMENT 'Override cycle; NULL means use the plan billing cycle',
    price_override DECIMAL(10, 2)  NULL COMMENT 'Custom price; NULL means use plan price',
    notes          TEXT            NULL,
    connection_type ENUM('pppoe', 'pppoe_dual', 'static', 'dual') NOT NULL DEFAULT 'pppoe'
                       COMMENT 'pppoe = PPPoE IPv4-only (requires RADIUS); pppoe_dual = PPPoE dual-stack IPv4+IPv6 (requires RADIUS); static = static IPv4 (no RADIUS); dual = dual-stack static IPv4+IPv6 (no RADIUS)',
    status         ENUM('active', 'expired', 'cancelled', 'pending') NOT NULL DEFAULT 'pending',
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contracts_client_id (client_id),
    KEY idx_contracts_plan_id (plan_id),
    KEY idx_contracts_site_id (site_id),
    KEY idx_contracts_connection_type (connection_type),
    KEY idx_contracts_status (status),
    CONSTRAINT fk_contracts_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
