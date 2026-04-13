-- Migration: 133_create_idempotency_keys_table
-- Description: Stores idempotency keys for payment charge requests to prevent
--              duplicate charges when the same key is submitted more than once.
--              Keys expire after 24 hours (cleaned up by a scheduled task or
--              application-level TTL check).

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    idempotency_key     VARCHAR(255)      NOT NULL                    COMMENT 'Client-supplied unique key for the charge request',
    organization_id     BIGINT UNSIGNED   NOT NULL                    COMMENT 'Tenant organization',
    status              ENUM('pending','completed','failed')
                                          NOT NULL DEFAULT 'pending'  COMMENT 'Processing status of the original request',
    response_code       SMALLINT UNSIGNED NOT NULL DEFAULT 200        COMMENT 'HTTP status code of the cached response',
    response_body       JSON              NOT NULL                    COMMENT 'Cached response body to return on replay',
    expires_at          TIMESTAMP         NOT NULL                    COMMENT 'Key expiry; after this time the key may be reused',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_idempotency_keys_org_key (organization_id, idempotency_key),
    KEY idx_idempotency_keys_expires_at (expires_at),
    CONSTRAINT fk_idempotency_keys_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
