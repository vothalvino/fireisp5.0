-- Migration: 118_create_cfdi_cancellations_table
-- Description: SAT CFDI cancellation audit trail. Records every cancellation
--              request sent to the SAT via a PAC, including the cancellation
--              reason code (motivo), optional replacement UUID
--              (folio_sustitucion), PAC response status, and the raw acuse XML
--              acknowledgement returned by the SAT. Required for fiscal
--              compliance (SAT regulations mandate 5-year retention).

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_cancellations (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    cfdi_document_id      BIGINT UNSIGNED  NOT NULL                    COMMENT 'The CFDI document being cancelled',
    organization_id       BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that issued the CFDI',
    uuid                  CHAR(36)         NOT NULL                    COMMENT 'UUID (folio fiscal) of the CFDI being cancelled',
    motivo                ENUM('01','02','03','04')
                                           NOT NULL                    COMMENT 'SAT cancellation reason: 01=CFDI con errores con relación, 02=CFDI con errores sin relación, 03=No se llevó a cabo la operación, 04=Operación nominativa relacionada en CFDI global',
    folio_sustitucion     CHAR(36)         NULL                        COMMENT 'UUID of the replacement CFDI; required when motivo=''01''',
    cancellation_status   ENUM('pending','accepted','rejected','cancelled_by_timeout')
                                           NOT NULL DEFAULT 'pending'  COMMENT 'SAT/PAC cancellation processing status',
    requested_at          TIMESTAMP        NOT NULL                    COMMENT 'Timestamp when the cancellation was submitted to the PAC/SAT',
    responded_at          TIMESTAMP        NULL                        COMMENT 'Timestamp when the SAT/PAC returned a final status',
    acuse_xml             LONGTEXT         NULL                        COMMENT 'Raw acuse (acknowledgement) XML returned by the SAT — required for fiscal records',
    acuse_fecha           DATETIME         NULL                        COMMENT 'FechaCancelacion from the SAT acuse XML',
    pac_provider_id       BIGINT UNSIGNED  NULL                        COMMENT 'PAC provider used to submit the cancellation; NULL if submitted directly',
    error_message         TEXT             NULL                        COMMENT 'Error description if the cancellation was rejected or failed',
    requested_by_user_id  BIGINT UNSIGNED  NULL                        COMMENT 'User who requested the cancellation; NULL = system-initiated',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_cancellations_uuid (uuid),
    KEY idx_cfdi_cancellations_cfdi_document_id (cfdi_document_id),
    KEY idx_cfdi_cancellations_organization_id (organization_id),
    KEY idx_cfdi_cancellations_status (cancellation_status),
    CONSTRAINT fk_cfdi_cancellations_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_pac_provider FOREIGN KEY (pac_provider_id)
        REFERENCES pac_providers (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_user FOREIGN KEY (requested_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
