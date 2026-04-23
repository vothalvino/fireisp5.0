-- Migration: 161_create_portal_refresh_tokens_table
-- Description: Stores refresh tokens for the client self-service portal.
--              Each row represents one active or revoked refresh token.

CREATE TABLE IF NOT EXISTS portal_refresh_tokens (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    token_hash  VARCHAR(64)     NOT NULL COMMENT 'SHA-256 hex of the opaque refresh token',
    expires_at  TIMESTAMP       NOT NULL,
    revoked_at  TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_portal_refresh_tokens_hash (token_hash),
    KEY idx_portal_refresh_tokens_client (client_id),
    CONSTRAINT fk_portal_refresh_tokens_client
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
