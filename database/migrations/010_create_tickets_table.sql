-- Migration: 010_create_tickets_table
-- Description: Creates the tickets table for customer support tracking

CREATE TABLE IF NOT EXISTS tickets (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id    BIGINT UNSIGNED NOT NULL,
    assigned_to  BIGINT UNSIGNED NULL,
    title        VARCHAR(255)    NOT NULL,
    description  TEXT            NULL,
    category     VARCHAR(100)    NULL COMMENT 'e.g. connectivity, billing, hardware',
    priority     ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
    status       ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    resolved_at  TIMESTAMP       NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_tickets_client_id (client_id),
    KEY idx_tickets_assigned_to (assigned_to),
    KEY idx_tickets_status (status),
    KEY idx_tickets_priority (priority),
    CONSTRAINT fk_tickets_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
