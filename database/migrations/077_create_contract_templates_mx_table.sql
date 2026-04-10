-- Migration: 077_create_contract_templates_mx_table
-- Description: Stores IFT/CRT-registered Carta de Adhesión (adhesion contract)
--              templates.  Mexican ISPs must register their standard contract
--              model with IFT/CRT before using it with clients.
--
--              Each organization may have multiple template versions over time
--              (e.g. when the registered template is updated and re-submitted).
--              Contracts (migration 006) reference the specific registered template
--              via the FK added in migration 078.

-- Disable FK checks: organizations and files created in earlier migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS contract_templates_mx (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization that owns this registered template',
    template_name           VARCHAR(200)    NOT NULL
                                COMMENT 'Internal descriptive name for this template version',
    ift_registration_number VARCHAR(100)    NULL
                                COMMENT 'Official registration number issued by IFT/CRT when the template was approved',
    registered_at           DATE            NULL
                                COMMENT 'Date IFT/CRT officially registered this template',
    version                 VARCHAR(20)     NOT NULL DEFAULT '1.0'
                                COMMENT 'Internal version label (e.g. 1.0, 2.0, 2025-rev1)',
    template_body           LONGTEXT        NULL
                                COMMENT 'Full text of the registered contract template',
    document_file_id        BIGINT UNSIGNED NULL
                                COMMENT 'Uploaded PDF/Word of the registered template in the files table',
    status                  ENUM('draft', 'submitted', 'registered', 'expired', 'revoked')
                                NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=being prepared; submitted=sent to IFT/CRT; registered=officially approved; expired=superseded; revoked=withdrawn',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contract_templates_mx_organization_id (organization_id),
    KEY idx_contract_templates_mx_status (status),
    KEY idx_contract_templates_mx_registered_at (registered_at),
    CONSTRAINT fk_contract_templates_mx_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_contract_templates_mx_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
