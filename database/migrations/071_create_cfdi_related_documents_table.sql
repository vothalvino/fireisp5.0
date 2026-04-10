-- Migration: 071_create_cfdi_related_documents_table
-- Description: Tracks CfdiRelacionados (CFDI 4.0 requirement).
--              When a CFDI references another CFDI (e.g. a credit note referencing
--              the original invoice, or a substitution referencing the cancelled
--              document), each relationship is recorded here.
--
--              relationship_type is the SAT c_TipoRelacion code (e.g. 01 = nota
--              de crédito, 04 = sustitución de los CFDI previos).

-- Disable FK checks: cfdi_documents is created in migration 070.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_related_documents (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cfdi_document_id    BIGINT UNSIGNED NOT NULL
                            COMMENT 'The CFDI that declares the relationship',
    related_uuid        CHAR(36)        NOT NULL
                            COMMENT 'UUID (folio fiscal) of the related CFDI',
    relationship_type   VARCHAR(2)      NOT NULL
                            COMMENT 'SAT c_TipoRelacion code (e.g. 01=nota de crédito, 04=sustitución)',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_related_docs_cfdi_id (cfdi_document_id),
    KEY idx_cfdi_related_docs_related_uuid (related_uuid),
    KEY idx_cfdi_related_docs_relationship_type (relationship_type),
    CONSTRAINT fk_cfdi_related_docs_cfdi FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
