-- Migration: 089_create_factura_publica_invoices_table
-- Description: Factura pública (venta al público en general) periodic
--              aggregation documents.
--
--              Mexican tax law (SAT CFDI 4.0) requires that when a client does
--              not request an individual factura, the sale must still be reported
--              through a factura pública — a single fiscal document that
--              aggregates all "venta al público en general" transactions for a
--              given period.
--
--              Each row represents one factura pública issued by an organization
--              for a specific periodicity window (daily, weekly, bi-weekly,
--              monthly, or bi-monthly).  The InformacionGlobal node fields
--              (Periodicidad, Meses, Año) required by SAT are stored here.
--
--              The actual stamped CFDI XML/UUID/PAC metadata lives in the linked
--              cfdi_documents record (via cfdi_document_id).  The cfdi_documents
--              row for a factura pública uses the generic receptor
--              RFC XAXX010101000.
--
--              Individual invoices belonging to this factura pública are tracked
--              through the factura_publica_invoice_items junction table
--              (migration 090).
--
--              This table only applies to MX-locale organizations — contracts
--              with facturar = FALSE generate invoices that feed into this table.

-- Disable FK checks: referenced tables may be created in other migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS factura_publica_invoices (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,

    -- Issuer
    organization_id         BIGINT UNSIGNED  NOT NULL
                                COMMENT 'Organization (ISP) issuing this factura pública',

    -- Link to the stamped CFDI record (NULL while accumulating / draft)
    cfdi_document_id        BIGINT UNSIGNED  NULL
                                COMMENT 'Stamped CFDI document record; NULL while the factura pública is still in draft',

    -- SAT InformacionGlobal node fields
    periodicidad            ENUM('01', '02', '03', '04', '05') NOT NULL
                                COMMENT 'SAT c_Periodicidad: 01=Diario, 02=Semanal, 03=Quincenal, 04=Mensual, 05=Bimestral',
    meses                   VARCHAR(2)       NOT NULL
                                COMMENT 'SAT c_Meses: 01-12=individual month, 13=Ene-Feb, 14=Mar-Abr, 15=May-Jun, 16=Jul-Ago, 17=Sep-Oct, 18=Nov-Dic',
    anio                    SMALLINT UNSIGNED NOT NULL
                                COMMENT 'Fiscal year for the InformacionGlobal node (e.g. 2026)',

    -- Aggregated totals (denormalized for quick reads)
    subtotal                DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Sum of all público en general invoice subtotals in this period',
    total_impuestos         DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Total transferred taxes for the period',
    total                   DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Grand total: subtotal + total_impuestos',

    -- Lifecycle
    status                  ENUM('draft', 'stamped', 'cancelled') NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=accumulating invoices; stamped=factura pública issued via PAC; cancelled=voided',

    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_factura_publica_invoices_period (organization_id, periodicidad, meses, anio),
    KEY idx_factura_publica_invoices_cfdi_document_id (cfdi_document_id),
    KEY idx_factura_publica_invoices_status (status),
    KEY idx_factura_publica_invoices_anio_meses (anio, meses),

    CONSTRAINT fk_factura_publica_invoices_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_factura_publica_invoices_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,

    -- Meses must be a valid SAT c_Meses code (01-18)
    CONSTRAINT chk_factura_publica_invoices_meses CHECK (
        meses IN ('01','02','03','04','05','06','07','08','09','10','11','12',
                  '13','14','15','16','17','18')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Factura pública (venta al público en general) — periodic aggregation of non-facturar sales per SAT CFDI 4.0 InformacionGlobal';

SET FOREIGN_KEY_CHECKS = 1;
