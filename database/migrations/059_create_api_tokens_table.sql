-- Migration: 059_create_api_tokens_table
-- Description: API keys for external integrations (third-party billing,
--              monitoring tools, etc.). Each token belongs to a user, has a
--              hashed secret, optional scopes, and an optional expiry date.
--              Supports revocation and last-used tracking.

CREATE TABLE IF NOT EXISTS api_tokens (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED  NOT NULL COMMENT 'User who owns this token',
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    name            VARCHAR(100)     NOT NULL COMMENT 'Human-readable label, e.g. "Grafana read-only"',
    token_hash      VARCHAR(255)     NOT NULL COMMENT 'SHA-256 hash of the API token (plain-text never stored)',
    scopes          JSON             NULL     COMMENT 'Allowed scopes, e.g. ["clients.read","invoices.read"]',
    last_used_at    TIMESTAMP        NULL     COMMENT 'Last time this token was used for authentication',
    last_used_ip    VARCHAR(45)      NULL     COMMENT 'IP address of last use',
    expires_at      TIMESTAMP        NULL     COMMENT 'Optional expiry; NULL = never expires',
    revoked_at      TIMESTAMP        NULL     COMMENT 'Set when token is revoked; non-NULL = inactive',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_api_tokens_hash (token_hash),
    KEY idx_api_tokens_user_id (user_id),
    KEY idx_api_tokens_organization_id (organization_id),
    KEY idx_api_tokens_expires_at (expires_at),
    CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_api_tokens_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
