-- Migration: 004_create_sites_table
-- Description: Creates the sites table for physical installation locations

CREATE TABLE IF NOT EXISTS sites (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    name        VARCHAR(255)    NOT NULL,
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
    KEY idx_sites_client_id (client_id),
    CONSTRAINT fk_sites_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
