-- Migration: 002_create_clients_table
-- Description: Creates the clients table for ISP customer records

CREATE TABLE IF NOT EXISTS clients (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this client belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL,
    email           VARCHAR(255)    NULL,
    phone           VARCHAR(30)     NULL,
    client_type     ENUM('personal', 'company') NOT NULL DEFAULT 'personal',
    tax_id          VARCHAR(50)     NULL,
    curp            VARCHAR(18)     NULL COMMENT 'Mexican personal ID (CURP) — personal clients only',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'US',
    zip_code        VARCHAR(20)     NULL,
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_clients_organization_id (organization_id),
    KEY idx_clients_status (status),
    KEY idx_clients_email (email),
    CONSTRAINT fk_clients_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
