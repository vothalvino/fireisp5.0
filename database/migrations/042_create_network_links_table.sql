-- Migration: 042_create_network_links_table
-- Description: Creates the network_links table to model device-to-device
--              connections — fiber, wireless, copper, or virtual links between
--              two devices, with optional capacity and interface metadata.

CREATE TABLE IF NOT EXISTS network_links (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_a_id     BIGINT UNSIGNED NOT NULL  COMMENT 'First endpoint device',
    device_b_id     BIGINT UNSIGNED NOT NULL  COMMENT 'Second endpoint device',
    link_type       ENUM('fiber', 'wireless', 'copper', 'virtual', 'other')
                        NOT NULL DEFAULT 'fiber'
                        COMMENT 'Physical or logical medium connecting the two devices',
    capacity_mbps   INT UNSIGNED    NULL      COMMENT 'Link capacity in Mbps (e.g. 1000 = 1 Gbps)',
    interface_a     VARCHAR(100)    NULL      COMMENT 'Interface name on device A (e.g. eth0, ether1, ge-0/0/0)',
    interface_b     VARCHAR(100)    NULL      COMMENT 'Interface name on device B',
    status          ENUM('active', 'down', 'maintenance', 'decommissioned')
                        NOT NULL DEFAULT 'active'
                        COMMENT 'Operational status of the link',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_network_links_device_a_id (device_a_id),
    KEY idx_network_links_device_b_id (device_b_id),
    KEY idx_network_links_link_type (link_type),
    KEY idx_network_links_status (status),
    CONSTRAINT fk_network_links_device_a FOREIGN KEY (device_a_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_network_links_device_b FOREIGN KEY (device_b_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_network_links_different_devices CHECK (device_a_id != device_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
