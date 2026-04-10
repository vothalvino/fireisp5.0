-- Migration: 083_create_cfdi_conceptos_table
-- Description: Line items (Conceptos) for CFDI 4.0 documents.  Every stamped
--              CFDI must have at least one concept in the <Conceptos> node.
--              Each row captures the SAT-required fields: product/service key,
--              unit key, quantity, description, unit price, and line total,
--              plus an optional discount and the SAT ObjetoImp indicator.
--
--              Tax details per concept are stored in cfdi_concepto_impuestos
--              (migration 085).

-- Disable FK checks: cfdi_documents is created in migration 070.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_conceptos (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,

    -- Parent CFDI document
    cfdi_document_id    BIGINT UNSIGNED     NOT NULL
                            COMMENT 'CFDI document this line item belongs to',

    -- SAT-required product/service and unit classification
    clave_prod_serv     VARCHAR(8)          NOT NULL
                            COMMENT 'SAT c_ClaveProdServ code identifying the product or service (e.g. 81161700)',
    clave_unidad        VARCHAR(10)         NOT NULL
                            COMMENT 'SAT c_ClaveUnidad unit-of-measure code (e.g. E48 for service unit)',

    -- Optional internal identifier
    no_identificacion   VARCHAR(100)        NULL
                            COMMENT 'Internal SKU or product code assigned by the issuer; NULL if not applicable',

    -- Quantity, description, and pricing
    cantidad            DECIMAL(12, 4)      NOT NULL
                            COMMENT 'Quantity of units sold or delivered',
    descripcion         VARCHAR(1000)       NOT NULL
                            COMMENT 'Free-text description of the product or service as it appears on the CFDI',
    valor_unitario      DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Unit price before taxes',
    importe             DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Line total: cantidad × valor_unitario (before discount)',
    descuento           DECIMAL(14, 4)      NULL
                            COMMENT 'Discount amount applied to this line; NULL when no discount',

    -- SAT tax object indicator (ObjetoImp)
    objeto_imp          ENUM('01', '02', '03') NOT NULL DEFAULT '02'
                            COMMENT 'SAT ObjetoImp: 01=No objeto de impuesto, 02=Sí objeto de impuesto, 03=Sí objeto del impuesto y no obligado al desglose',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_conceptos_cfdi_document_id (cfdi_document_id),
    KEY idx_cfdi_conceptos_clave_prod_serv (clave_prod_serv),

    CONSTRAINT fk_cfdi_conceptos_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CFDI 4.0 concept (line item) rows — one row per <Concepto> node inside a cfdi_document';

SET FOREIGN_KEY_CHECKS = 1;
