-- Migration: 054_create_vlans_table
-- Description: VLAN registry linked to sites. Most ISPs assign VLANs per site
--              or per client — this table tracks VLAN IDs so they can be
--              referenced by contracts and devices for network segmentation,
--              service isolation, and capacity planning.

CREATE TABLE IF NOT EXISTS vlans (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    site_id         BIGINT UNSIGNED  NOT NULL COMMENT 'Site this VLAN belongs to',
    vlan_id         SMALLINT UNSIGNED NOT NULL COMMENT 'IEEE 802.1Q VLAN ID (1-4094)',
    name            VARCHAR(255)     NOT NULL COMMENT 'Descriptive label, e.g. "Client-Data", "Management", "VoIP"',
    description     TEXT             NULL,
    status          ENUM('active', 'reserved', 'deprecated') NOT NULL DEFAULT 'active'
                        COMMENT 'active = in use; reserved = allocated but not yet deployed; deprecated = phasing out',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_vlans_site_vlan (site_id, vlan_id) COMMENT 'A VLAN ID must be unique within a site',
    KEY idx_vlans_site_id (site_id),
    KEY idx_vlans_status (status),
    CONSTRAINT fk_vlans_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_vlans_vlan_id CHECK (vlan_id BETWEEN 1 AND 4094)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
