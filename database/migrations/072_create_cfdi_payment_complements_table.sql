-- Migration: 072_create_cfdi_payment_complements_table
-- Description: Complemento de Pago 2.0 (Recibo Electrónico de Pago) header record.
--              Required for every CFDI tipo P (pago) — i.e. when the original
--              invoice was issued with metodo_pago = 'PPD' (Pago en Parcialidades
--              o Diferido) and the client later makes a payment.
--
--              Each payment event that covers one or more previously-issued PPD
--              invoices gets one row here.  The detail of which invoices are being
--              settled and for how much is stored in
--              cfdi_payment_complement_items (migration 073).

-- Disable FK checks: cfdi_documents is created in migration 070.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_payment_complements (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cfdi_document_id    BIGINT UNSIGNED NOT NULL
                            COMMENT 'Parent CFDI type-P document that carries this complement',

    -- Payment event details
    payment_date        DATE            NOT NULL
                            COMMENT 'Date the payment was received (FechaPago)',
    forma_pago          VARCHAR(2)      NOT NULL
                            COMMENT 'SAT c_FormaPago — how the payment was made (e.g. 03=transfer, 28=debit card)',
    moneda              VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                            COMMENT 'SAT c_Moneda — currency the payment was received in',
    tipo_cambio         DECIMAL(10, 4)  NULL
                            COMMENT 'Exchange rate to MXN when moneda != MXN',
    amount              DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Total amount of this payment event',
    operation_number    VARCHAR(100)    NULL
                            COMMENT 'Bank transaction or reference number for the payment',

    -- Payer bank details
    payer_rfc           VARCHAR(13)     NULL
                            COMMENT 'RFC of the payer (when available from bank data)',
    payer_bank_name     VARCHAR(100)    NULL
                            COMMENT 'Name of the payer bank',
    payer_account       VARCHAR(50)     NULL
                            COMMENT 'CLABE or account number of the payer',

    -- Beneficiary (ISP) bank details
    beneficiary_rfc     VARCHAR(13)     NULL
                            COMMENT 'RFC of the beneficiary (organization RFC)',
    beneficiary_account VARCHAR(50)     NULL
                            COMMENT 'CLABE or account number of the beneficiary',

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_payment_complements_cfdi_id (cfdi_document_id),
    KEY idx_cfdi_payment_complements_payment_date (payment_date),
    KEY idx_cfdi_payment_complements_forma_pago (forma_pago),
    CONSTRAINT fk_cfdi_payment_complements_cfdi FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
