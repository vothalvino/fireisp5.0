-- Migration: 013_create_quotes_table
-- Description: Creates the quotes table for service estimates and proposals

CREATE TABLE IF NOT EXISTS quotes (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id    BIGINT UNSIGNED NOT NULL,
    quote_number VARCHAR(50)     NOT NULL,
    issue_date   DATE            NOT NULL,
    expiry_date  DATE            NULL,
    subtotal     DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate     DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount   DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total        DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    notes        TEXT            NULL,
    status       ENUM('draft', 'sent', 'accepted', 'rejected', 'expired') NOT NULL DEFAULT 'draft',
    created_by   BIGINT UNSIGNED NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_quotes_number (quote_number),
    KEY idx_quotes_client_id (client_id),
    KEY idx_quotes_status (status),
    CONSTRAINT fk_quotes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_quotes_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
