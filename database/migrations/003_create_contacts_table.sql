-- Migration: 003_create_contacts_table
-- Description: Creates the contacts table for client contact persons

CREATE TABLE IF NOT EXISTS contacts (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    first_name  VARCHAR(100)    NOT NULL,
    last_name   VARCHAR(100)    NOT NULL,
    email       VARCHAR(255)    NULL,
    phone       VARCHAR(30)     NULL,
    role        VARCHAR(100)    NULL COMMENT 'e.g. Owner, Billing, Technical',
    is_primary  TINYINT(1)      NOT NULL DEFAULT 0,
    notes       TEXT            NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contacts_client_id (client_id),
    CONSTRAINT fk_contacts_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
