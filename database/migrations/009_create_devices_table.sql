-- Migration: 009_create_devices_table
-- Description: Creates the devices table for network equipment inventory,
--              supporting both client devices (Outdoor/Indoor CPE) and
--              POP infrastructure (PTP, PTMP, OLT, Router, Switch, ONU, etc.)

CREATE TABLE IF NOT EXISTS devices (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    site_id       BIGINT UNSIGNED NULL,
    client_id     BIGINT UNSIGNED NULL,
    category      ENUM('client', 'pop') NOT NULL DEFAULT 'client'
                      COMMENT 'client=Customer Premises Equipment (Outdoor/Indoor CPE), pop=POP Infrastructure (PTP, PTMP, OLT, Router, etc.)',
    name          VARCHAR(255)    NOT NULL,
    type          ENUM(
                      'outdoor_cpe',
                      'indoor_cpe',
                      'ptp',
                      'ptmp_ap',
                      'olt',
                      'router',
                      'switch',
                      'onu',
                      'other'
                  ) NOT NULL DEFAULT 'other'
                      COMMENT 'Device type — client: outdoor_cpe, indoor_cpe; pop: ptp, ptmp_ap, olt, router, switch, onu',
    manufacturer  VARCHAR(100)    NULL,
    model         VARCHAR(100)    NULL,
    serial_number VARCHAR(100)    NULL,
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    ip_address    VARCHAR(45)     NULL COMMENT 'Management IPv4 address',
    ipv6_address  VARCHAR(45)     NULL COMMENT 'Management IPv6 address (dual-stack)',
    firmware      VARCHAR(100)    NULL,
    status        ENUM('online', 'offline', 'maintenance') NOT NULL DEFAULT 'offline',
    notes         TEXT            NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_devices_site_id (site_id),
    KEY idx_devices_client_id (client_id),
    KEY idx_devices_category (category),
    KEY idx_devices_status (status),
    CONSTRAINT fk_devices_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_devices_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
