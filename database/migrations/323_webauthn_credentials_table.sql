-- Migration 323 — webauthn_credentials table
-- Purpose: Store WebAuthn/FIDO2 hardware key credential registrations per user.
-- Tables: webauthn_credentials

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL COMMENT 'User who owns this credential',
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Tenant organization; NULL = single-tenant deployment',
    credential_id       VARCHAR(1024)   NOT NULL COMMENT 'Base64url-encoded credential ID from authenticator',
    public_key          TEXT            NOT NULL COMMENT 'COSE-encoded public key (base64url)',
    aaguid              VARCHAR(36)     NULL COMMENT 'Authenticator AAGUID (UUID format)',
    sign_count          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Monotonic signature counter for clone detection',
    transports          JSON            NULL COMMENT 'Supported transports: [usb, nfc, ble, internal, hybrid]',
    attestation_type    VARCHAR(50)     NULL COMMENT 'none, self, packed, tpm, android-key, fido-u2f',
    device_type         ENUM('platform','cross-platform') NOT NULL DEFAULT 'cross-platform',
    is_backup_eligible  TINYINT(1)      NOT NULL DEFAULT 0,
    is_backed_up        TINYINT(1)      NOT NULL DEFAULT 0,
    friendly_name       VARCHAR(100)    NULL COMMENT 'User-visible label, e.g. "YubiKey 5C"',
    last_used_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_webauthn_credentials_credential_id (credential_id(512)),
    KEY idx_webauthn_credentials_user_id (user_id),
    KEY idx_webauthn_credentials_org_id (organization_id),
    KEY idx_webauthn_credentials_deleted_at (deleted_at),
    CONSTRAINT fk_webauthn_credentials_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_webauthn_credentials_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='WebAuthn/FIDO2 hardware key credential registrations per user (§17)';
