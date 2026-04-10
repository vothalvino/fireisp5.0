-- Migration: 073_create_cfdi_payment_complement_items_table
-- Description: DoctoRelacionado rows for Complemento de Pago 2.0.
--              Each item links one previously-issued PPD invoice (by its CFDI UUID)
--              to the payment complement, recording the outstanding balance before
--              and after the partial or full payment.
--
--              Multiple items per complement are allowed when a single payment
--              event settles more than one open invoice.

-- Disable FK checks: cfdi_payment_complements is created in migration 072.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_payment_complement_items (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    complement_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'Parent payment complement this item belongs to',

    -- Related CFDI being settled
    related_cfdi_uuid   CHAR(36)        NOT NULL
                            COMMENT 'UUID (folio fiscal) of the PPD invoice being paid',
    serie               VARCHAR(10)     NULL
                            COMMENT 'Series of the related CFDI (for display)',
    folio               VARCHAR(40)     NULL
                            COMMENT 'Folio of the related CFDI (for display)',

    -- Currency of the related document
    moneda_dr           VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                            COMMENT 'SAT c_Moneda — currency of the document being paid (MonedaDR)',
    equivalencia_dr     DECIMAL(10, 4)  NOT NULL DEFAULT 1.0000
                            COMMENT 'Exchange rate between moneda_dr and the complement payment currency',

    -- Installment tracking
    num_parcialidad     INT UNSIGNED    NOT NULL DEFAULT 1
                            COMMENT 'Installment number for this payment (1 = first partial or full payment)',

    -- Balance tracking (required by Complemento de Pago 2.0)
    imp_saldo_ant       DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Outstanding balance before this payment (ImpSaldoAnt)',
    imp_pagado          DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Amount paid toward this document in this complement (ImpPagado)',
    imp_saldo_insoluto  DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Remaining balance after this payment: imp_saldo_ant - imp_pagado (ImpSaldoInsoluto)',

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_pci_complement_id (complement_id),
    KEY idx_cfdi_pci_related_uuid (related_cfdi_uuid),
    CONSTRAINT fk_cfdi_pci_complement FOREIGN KEY (complement_id)
        REFERENCES cfdi_payment_complements (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
