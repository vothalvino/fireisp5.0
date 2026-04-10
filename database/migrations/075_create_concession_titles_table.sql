-- Migration: 075_create_concession_titles_table
-- Description: Stores IFT (Instituto Federal de Telecomunicaciones) and CRT
--              (Comisión de Regulación de Telecomunicaciones) concession titles
--              for each organization.
--
--              Mexican ISPs must hold a valid concession title to operate legally.
--              This table tracks the title number, type, geographic scope, authorized
--              services, spectrum bands (when applicable), validity dates, and
--              regulatory status so the application can warn operators of upcoming
--              expirations and required renewal filings.

-- Disable FK checks: organizations and files created in earlier migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS concession_titles (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL
                            COMMENT 'Organization that holds this concession title',
    title_number        VARCHAR(100)    NOT NULL UNIQUE
                            COMMENT 'Official concession title number as issued by IFT/CRT',
    concession_type     ENUM('commercial', 'public', 'social', 'community', 'indigenous', 'private')
                            NOT NULL DEFAULT 'commercial'
                            COMMENT 'Type of concession as defined by the LFTR',
    services_authorized JSON            NOT NULL
                            COMMENT 'JSON array of authorized services (e.g. ["internet","voip","data"])',
    geographic_scope    TEXT            NULL
                            COMMENT 'Description of the authorized geographic area (states, municipalities)',
    spectrum_bands      JSON            NULL
                            COMMENT 'JSON array of spectrum bands assigned (if applicable)',
    granted_date        DATE            NOT NULL
                            COMMENT 'Date the concession was originally granted',
    expiration_date     DATE            NULL
                            COMMENT 'Concession expiry date; NULL = indefinite duration',
    renewal_filed_at    DATE            NULL
                            COMMENT 'Date the renewal application was submitted to IFT/CRT',
    regulatory_body     ENUM('IFT', 'CRT') NOT NULL DEFAULT 'CRT'
                            COMMENT 'IFT = Instituto Federal de Telecomunicaciones (pre-2025); CRT = Comisión de Regulación de Telecomunicaciones (from 2025)',
    document_file_id    BIGINT UNSIGNED NULL
                            COMMENT 'Reference to the official title document in the files table',
    status              ENUM('active', 'expired', 'revoked', 'pending_renewal')
                            NOT NULL DEFAULT 'active'
                            COMMENT 'active=valid; expired=past expiry; revoked=cancelled by authority; pending_renewal=renewal in progress',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_concession_titles_title_number (title_number),
    KEY idx_concession_titles_organization_id (organization_id),
    KEY idx_concession_titles_status (status),
    KEY idx_concession_titles_regulatory_body (regulatory_body),
    KEY idx_concession_titles_expiration_date (expiration_date),
    CONSTRAINT fk_concession_titles_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_concession_titles_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
