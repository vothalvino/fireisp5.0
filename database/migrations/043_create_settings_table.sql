-- Migration: 043_create_settings_table
-- Description: App settings / key-value configuration store for system-wide
--              settings such as default tax rate, currency, invoice number
--              prefix, SMTP config, SNMP poll interval, etc.

CREATE TABLE IF NOT EXISTS settings (
    id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    setting_key   VARCHAR(100)     NOT NULL,
    setting_value TEXT             NULL,
    description   VARCHAR(255)     NULL,
    created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
