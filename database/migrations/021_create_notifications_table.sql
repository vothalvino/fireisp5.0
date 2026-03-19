-- ---------------------------------------------------------------------------
-- Migration 021: Create notifications table
-- Purpose: System notifications and alerts for users (billing reminders,
--          network alerts, ticket updates, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL COMMENT 'Recipient user',
    title       VARCHAR(255)    NOT NULL,
    body        TEXT            NULL,
    type        ENUM('info', 'warning', 'error', 'billing', 'network', 'ticket') NOT NULL DEFAULT 'info',
    entity_type VARCHAR(50)     NULL     COMMENT 'Related entity e.g. invoices, tickets',
    entity_id   BIGINT UNSIGNED NULL     COMMENT 'Related entity ID for deep linking',
    is_read     TINYINT(1)      NOT NULL DEFAULT 0,
    read_at     TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_notifications_user_id (user_id),
    KEY idx_notifications_is_read (is_read),
    KEY idx_notifications_type (type),
    KEY idx_notifications_created_at (created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
