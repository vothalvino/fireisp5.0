-- Migration: 007_create_nas_table
-- Description: Creates the NAS (Network Access Server) table for RADIUS infrastructure

CREATE TABLE IF NOT EXISTS nas (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255)    NOT NULL,
    ip_address    VARCHAR(45)     NOT NULL COMMENT 'Primary IPv4 address',
    ipv6_address  VARCHAR(45)     NULL     COMMENT 'IPv6 management address (dual-stack)',
    secret      VARCHAR(255)    NOT NULL COMMENT 'RADIUS shared secret',
    type        VARCHAR(50)     NOT NULL DEFAULT 'other' COMMENT 'e.g. mikrotik, cisco, ubiquiti',
    ports       INT UNSIGNED    NULL,
    description TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_nas_ip_address (ip_address),
    KEY idx_nas_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
