-- Migration: 048_create_user_sessions_table
-- Description: Active session tracking for security audit. Stores user sessions
--              (hashed token, IP, user-agent, expiry) allowing features such as
--              "logout all devices" and suspicious-login detection.

CREATE TABLE IF NOT EXISTS user_sessions (
    id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED  NOT NULL,
    token_hash     VARCHAR(255)     NOT NULL COMMENT 'Hashed session or refresh token',
    ip_address     VARCHAR(45)      NULL,
    user_agent     VARCHAR(500)     NULL,
    expires_at     TIMESTAMP        NOT NULL,
    last_active_at TIMESTAMP        NULL,
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_sessions_token (token_hash),
    KEY idx_user_sessions_user_id (user_id),
    KEY idx_user_sessions_expires_at (expires_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
