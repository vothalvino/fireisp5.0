-- Migration: 106_create_csd_certificates_table
-- Description: CSD (Certificado de Sello Digital) storage per organization
--              for SAT CFDI 4.0 stamping (timbrado). Holds the PEM-encoded
--              public certificate and encrypted private key so the PAC
--              integration layer can sign XML documents without external
--              key files on disk.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS csd_certificates (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                   COMMENT 'Organization this CSD belongs to',
    certificate_number    VARCHAR(20)      NOT NULL                   COMMENT 'NoCertificado value from the .cer file (20-digit SAT serial)',
    rfc                   VARCHAR(13)      NOT NULL                   COMMENT 'RFC of the certificate holder (must match organization_mx_profiles.rfc)',
    issuer_name           VARCHAR(300)     NULL                       COMMENT 'Certificate issuer DN as stored in the .cer',
    serial_number         VARCHAR(100)     NULL                       COMMENT 'X.509 serial number in hex',
    valid_from            DATETIME         NOT NULL                   COMMENT 'Certificate notBefore date/time',
    valid_to              DATETIME         NOT NULL                   COMMENT 'Certificate notAfter date/time — used for expiry monitoring',
    cer_pem               TEXT             NOT NULL                   COMMENT 'PEM-encoded public certificate (.cer converted to PEM)',
    key_pem_encrypted     TEXT             NOT NULL                   COMMENT 'Application-encrypted PEM-encoded private key (.key)',
    passphrase_encrypted  TEXT             NULL                       COMMENT 'Application-encrypted passphrase for the private key, if applicable',
    fingerprint_sha256    VARCHAR(64)      NOT NULL                   COMMENT 'SHA-256 fingerprint of the public certificate for deduplication',
    is_active             TINYINT(1)       NOT NULL DEFAULT 1         COMMENT 'TRUE = this certificate is in use for stamping',
    status                ENUM('active','expired','revoked')
                                           NOT NULL DEFAULT 'active'  COMMENT 'Certificate lifecycle status',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_csd_certificate_number (certificate_number),
    UNIQUE KEY uq_csd_fingerprint (fingerprint_sha256),
    KEY idx_csd_organization_active (organization_id, is_active),
    KEY idx_csd_valid_to (valid_to),
    CONSTRAINT fk_csd_certificates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
