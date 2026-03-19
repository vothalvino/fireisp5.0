-- ---------------------------------------------------------------------------
-- Migration 019: Create ip_assignments table
-- Purpose: Track individual IP address assignments to clients / devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_assignments (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pool_id     BIGINT UNSIGNED NOT NULL COMMENT 'Parent IP pool',
    client_id   BIGINT UNSIGNED NULL     COMMENT 'Assigned client',
    device_id   BIGINT UNSIGNED NULL     COMMENT 'Assigned device',
    ip_address  VARCHAR(45)     NOT NULL COMMENT 'Assigned IPv4 or IPv6 address',
    prefix_len  TINYINT UNSIGNED NULL     COMMENT 'For IPv6 prefix delegation: prefix length delegated to subscriber (e.g. 48, 56, 64); NULL for single-address assignments',
    mac_address VARCHAR(17)     NULL     COMMENT 'Bound MAC address (XX:XX:XX:XX:XX:XX)',
    type        ENUM('static', 'dynamic', 'reserved') NOT NULL DEFAULT 'dynamic',
    notes       TEXT            NULL,
    status      ENUM('active', 'available', 'expired') NOT NULL DEFAULT 'available'
                    COMMENT 'Lifecycle state — reservation intent is captured by the type field',
    assigned_at TIMESTAMP       NULL,
    expires_at  TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_assignments_ip (ip_address),
    KEY idx_ip_assignments_pool_id (pool_id),
    KEY idx_ip_assignments_client_id (client_id),
    KEY idx_ip_assignments_device_id (device_id),
    KEY idx_ip_assignments_status (status),
    CONSTRAINT fk_ip_assignments_pool FOREIGN KEY (pool_id)
        REFERENCES ip_pools (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
