-- Migration 332 — encryption_key_metadata table
-- Purpose: Key management and rotation tracking for all encryption keys used in the platform.
-- Tables: encryption_key_metadata

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS encryption_key_metadata (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Tenant scope; NULL = system-wide key',
    key_id              VARCHAR(100)    NOT NULL COMMENT 'Unique key identifier (e.g. key-2024-01-aes256)',
    purpose             VARCHAR(100)    NOT NULL COMMENT 'What this key encrypts (e.g. snmp_credentials, payment_data, totp_secrets)',
    algorithm           VARCHAR(50)     NOT NULL DEFAULT 'AES-256-GCM' COMMENT 'Encryption algorithm',
    key_length_bits     SMALLINT UNSIGNED NULL DEFAULT 256,
    key_reference       VARCHAR(500)    NULL COMMENT 'KMS key ARN or Vault path; NULL if local key',
    status              ENUM('active','retired','compromised','pending_rotation') NOT NULL DEFAULT 'active',
    version             SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    rotated_at          DATETIME        NULL COMMENT 'When key was last rotated',
    expires_at          DATETIME        NULL COMMENT 'Scheduled expiry; NULL = no expiry',
    next_rotation_at    DATETIME        NULL COMMENT 'Scheduled next rotation',
    rotated_by          BIGINT UNSIGNED NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_encryption_key_metadata_key_id (key_id),
    KEY idx_encryption_key_metadata_org (organization_id),
    KEY idx_encryption_key_metadata_purpose (purpose),
    KEY idx_encryption_key_metadata_status (status),
    CONSTRAINT fk_encryption_key_metadata_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_encryption_key_metadata_rotated_by FOREIGN KEY (rotated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encryption key management and rotation tracking (§17)';
