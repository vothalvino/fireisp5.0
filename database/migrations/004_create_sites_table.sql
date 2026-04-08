-- Migration: 004_create_sites_table
-- Description: Creates the sites table for transport network NMS locations

CREATE TABLE IF NOT EXISTS sites (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this site belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL,
    site_type       ENUM('pop', 'data_center', 'tower', 'aggregation_node', 'other')
                                    NOT NULL DEFAULT 'other'
                                    COMMENT 'pop=Point of Presence, data_center=Data Center, tower=Transmission Tower, aggregation_node=Network Aggregation Node',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'US',
    zip_code        VARCHAR(20)     NULL,
    latitude        DECIMAL(10, 8)  NULL,
    longitude       DECIMAL(11, 8)  NULL,
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_sites_organization_id (organization_id),
    KEY idx_sites_site_type (site_type),
    CONSTRAINT fk_sites_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
