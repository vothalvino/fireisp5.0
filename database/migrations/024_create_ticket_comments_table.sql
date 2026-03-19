-- Migration: 024_create_ticket_comments_table
-- Description: Creates the ticket_comments table for conversation tracking on support tickets

CREATE TABLE IF NOT EXISTS ticket_comments (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id  BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED NULL     COMMENT 'Staff member who posted the comment; NULL for system messages',
    body       TEXT            NOT NULL,
    is_internal TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1 = internal note visible only to staff',
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ticket_comments_ticket_id (ticket_id),
    KEY idx_ticket_comments_user_id (user_id),
    CONSTRAINT fk_ticket_comments_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_comments_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
