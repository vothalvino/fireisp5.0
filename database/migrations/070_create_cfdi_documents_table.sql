-- Migration: 070_create_cfdi_documents_table
-- Description: Core CFDI 4.0 document table.  One row per stamped (or draft)
--              electronic fiscal document issued by an organization to a client.
--
--              NULL cfdi_document_id on invoices/credit_notes/payments = global
--              client, no CFDI required.  Populated = MX client, CFDI issued.
--
--              Polymorphic source linkage (invoice_id / credit_note_id / payment_id)
--              is constrained so that at most one source is linked per document.
--              All three NULLs is valid for draft CFDIs not yet linked to a source.
--
--              The receiver snapshot (receptor_*) is intentionally denormalized:
--              once the CFDI is stamped the SAT requires the receptor data to be
--              immutable in the XML, so we capture it at stamp time rather than
--              joining back to the client profile.

-- Disable FK checks: tables referenced may be created in other migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_documents (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- Issuer & receiver references
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization (ISP) that issued this CFDI',
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'Client (receptor) for this CFDI',

    -- SAT folio fiscal (UUID assigned by PAC after stamping)
    uuid                    CHAR(36)        NULL     UNIQUE
                                COMMENT 'Folio fiscal UUID assigned by the PAC after successful stamping; NULL while in draft',

    -- Series and folio (issuer-assigned numbering)
    serie                   VARCHAR(10)     NULL
                                COMMENT 'CFDI series prefix (e.g. A, E, P)',
    folio                   BIGINT UNSIGNED NULL
                                COMMENT 'Sequential folio number within the series',

    -- Document classification (FK to SAT catalog)
    tipo_comprobante        VARCHAR(1)      NOT NULL
                                COMMENT 'SAT c_TipoDeComprobante: I=ingreso, E=egreso, P=pago, T=traslado, N=nomina',
    uso_cfdi                VARCHAR(4)      NOT NULL
                                COMMENT 'SAT c_UsoCFDI — receptor intended use (e.g. G03, S01)',
    metodo_pago             VARCHAR(3)      NULL
                                COMMENT 'SAT c_MetodoPago: PUE or PPD',
    forma_pago              VARCHAR(2)      NULL
                                COMMENT 'SAT c_FormaPago: payment instrument code (e.g. 03, 28)',

    -- Currency
    moneda                  VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                                COMMENT 'SAT c_Moneda currency code',
    tipo_cambio             DECIMAL(10, 4)  NULL
                                COMMENT 'Exchange rate to MXN when moneda != MXN; NULL when moneda = MXN',

    -- Receiver snapshot (denormalized at stamp time — must match SAT records)
    receptor_rfc            VARCHAR(13)     NULL
                                COMMENT 'Receiver RFC captured at stamp time',
    receptor_nombre         VARCHAR(300)    NULL
                                COMMENT 'Receiver razon_social captured at stamp time',
    receptor_regimen        VARCHAR(3)      NULL
                                COMMENT 'Receiver regimen_fiscal captured at stamp time',
    receptor_cp             VARCHAR(5)      NULL
                                COMMENT 'Receiver codigo_postal_fiscal captured at stamp time',

    -- Amounts
    subtotal                DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Sum of concept amounts before taxes',
    total_impuestos         DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Total taxes (IVA, IEPS, etc.) transferred or withheld',
    total                   DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Grand total: subtotal +/- taxes',

    -- XML & PDF storage
    xml_content             MEDIUMTEXT      NULL
                                COMMENT 'Full signed CFDI XML as returned by the PAC',
    pdf_url                 VARCHAR(500)    NULL
                                COMMENT 'URL or path to the generated PDF representation',

    -- PAC stamping metadata
    pac_provider            VARCHAR(50)     NULL
                                COMMENT 'PAC that stamped this CFDI (e.g. Finkok, TimbraSoft)',
    stamp_date              DATETIME        NULL
                                COMMENT 'FechaTimbrado from the PAC timbrado complement',
    certificate_number      VARCHAR(30)     NULL
                                COMMENT 'NoCertificadoSAT from the PAC timbrado complement',
    sat_seal                TEXT            NULL
                                COMMENT 'SelloSAT from the PAC timbrado complement',

    -- SAT status lifecycle
    sat_status              ENUM('draft', 'vigente', 'cancelado', 'cancel_pending')
                                NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=not yet stamped; vigente=valid; cancel_pending=cancellation requested; cancelado=SAT confirmed cancellation',

    -- Cancellation fields
    cancellation_reason     ENUM('01', '02', '03', '04') NULL
                                COMMENT 'SAT c_MotivoCancelacion: 01=error in invoice, 02=not issued, 03=not defined, 04=nominative substitution',
    cancellation_uuid       CHAR(36)        NULL
                                COMMENT 'UUID of the substitute CFDI (required for reason 04)',
    cancelled_at            DATETIME        NULL
                                COMMENT 'Timestamp when SAT confirmed cancellation',

    -- Source document linkage (polymorphic — at most one may be non-NULL)
    invoice_id              BIGINT UNSIGNED NULL
                                COMMENT 'Invoice this CFDI type-I belongs to; NULL for other types or drafts',
    credit_note_id          BIGINT UNSIGNED NULL
                                COMMENT 'Credit note this CFDI type-E belongs to; NULL for other types',
    payment_id              BIGINT UNSIGNED NULL
                                COMMENT 'Payment this CFDI type-P complement belongs to; NULL for other types',

    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_cfdi_documents_uuid (uuid),
    KEY idx_cfdi_documents_organization_id (organization_id),
    KEY idx_cfdi_documents_client_id (client_id),
    KEY idx_cfdi_documents_tipo_comprobante (tipo_comprobante),
    KEY idx_cfdi_documents_sat_status (sat_status),
    KEY idx_cfdi_documents_stamp_date (stamp_date),
    KEY idx_cfdi_documents_invoice_id (invoice_id),
    KEY idx_cfdi_documents_credit_note_id (credit_note_id),
    KEY idx_cfdi_documents_payment_id (payment_id),
    KEY idx_cfdi_documents_serie_folio (serie, folio),

    CONSTRAINT fk_cfdi_documents_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cfdi_documents_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cfdi_documents_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,

    -- At most one source document may be linked per CFDI
    CONSTRAINT chk_cfdi_documents_single_source CHECK (
        (
            (invoice_id     IS NOT NULL AND credit_note_id IS NULL     AND payment_id IS NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NOT NULL  AND payment_id IS NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NULL      AND payment_id IS NOT NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NULL      AND payment_id IS NULL)
        )
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
