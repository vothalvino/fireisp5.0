-- Migration 326 — api_key_rate_limits table
-- Purpose: Per-API-key rate limit configuration (requests per minute/day overrides).
-- Tables: api_key_rate_limits

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS api_key_rate_limits (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    api_token_id            BIGINT UNSIGNED NOT NULL COMMENT 'FK to api_tokens.id',
    organization_id         BIGINT UNSIGNED NULL,
    requests_per_minute     INT UNSIGNED    NULL DEFAULT 60 COMMENT 'Max requests per minute; NULL = use global default',
    requests_per_hour       INT UNSIGNED    NULL DEFAULT 1000 COMMENT 'Max requests per hour; NULL = use global default',
    requests_per_day        INT UNSIGNED    NULL DEFAULT 10000 COMMENT 'Max requests per day; NULL = use global default',
    burst_size              SMALLINT UNSIGNED NULL DEFAULT 20 COMMENT 'Token-bucket burst capacity',
    is_active               TINYINT(1)      NOT NULL DEFAULT 1,
    notes                   VARCHAR(500)    NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_api_key_rate_limits_token (api_token_id),
    KEY idx_api_key_rate_limits_org (organization_id),
    CONSTRAINT fk_api_key_rate_limits_token FOREIGN KEY (api_token_id)
        REFERENCES api_tokens (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_api_key_rate_limits_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-API-key rate limit overrides (§17)';
