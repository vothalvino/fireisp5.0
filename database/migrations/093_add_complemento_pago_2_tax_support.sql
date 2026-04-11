-- Migration: 093_add_complemento_pago_2_tax_support
-- Description: Adds SAT Complemento de Pago 2.0 tax breakdown support.
--
--              Two changes:
--
--              1. Adds `objeto_imp_dr` column to cfdi_payment_complement_items.
--                 The ObjetoImpDR attribute on DoctoRelacionado indicates whether
--                 the related document is subject to tax breakdown.
--
--                 Values:
--                   01 — No objeto de impuesto
--                   02 — Sí objeto de impuesto (default — most PPD invoices)
--                   03 — Sí objeto de impuesto y no obligado al desglose
--
--              2. Creates cfdi_payment_complement_item_taxes table to store the
--                 per-DoctoRelacionado tax breakdown (ImpuestosP) required by
--                 Complemento de Pago 2.0 when objeto_imp_dr = '02'.
--
--                 Each row corresponds to one Traslado or Retencion node inside
--                 the ImpuestosP element of a DoctoRelacionado.

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------
-- 1. Add objeto_imp_dr to cfdi_payment_complement_items
-- -----------------------------------------------------------------------
ALTER TABLE cfdi_payment_complement_items
    ADD COLUMN objeto_imp_dr ENUM('01','02','03') NOT NULL DEFAULT '02'
        COMMENT 'SAT ObjetoImpDR on DoctoRelacionado: 01=No objeto, 02=Sí objeto, 03=Sí objeto y no obligado al desglose'
        AFTER imp_saldo_insoluto;

-- -----------------------------------------------------------------------
-- 2. Create cfdi_payment_complement_item_taxes
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_payment_complement_item_taxes (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    complement_item_id  BIGINT UNSIGNED     NOT NULL
                            COMMENT 'Parent DoctoRelacionado item this tax row belongs to',
    tax_type            ENUM('traslado','retencion') NOT NULL
                            COMMENT 'Whether this is a transferred tax (Traslado) or a withholding (Retencion)',
    impuesto            VARCHAR(3)          NOT NULL
                            COMMENT 'SAT tax code: 001=ISR, 002=IVA, 003=IEPS',
    tipo_factor         ENUM('Tasa','Cuota','Exento') NOT NULL DEFAULT 'Tasa'
                            COMMENT 'SAT TipoFactorP: Tasa=rate, Cuota=fixed amount per unit, Exento=exempt',
    tasa_o_cuota        DECIMAL(8,6)        NULL
                            COMMENT 'Tax rate or per-unit quota; NULL when tipo_factor = ''Exento''',
    base                DECIMAL(14,4)       NOT NULL
                            COMMENT 'Taxable base amount for this tax line (BaseP)',
    importe             DECIMAL(14,4)       NULL
                            COMMENT 'Computed tax amount (ImporteP); NULL when tipo_factor = ''Exento''',
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_pcit_complement_item_id (complement_item_id),
    KEY idx_cfdi_pcit_tax_type (tax_type),
    KEY idx_cfdi_pcit_impuesto (impuesto),

    CONSTRAINT fk_cfdi_pcit_complement_item FOREIGN KEY (complement_item_id)
        REFERENCES cfdi_payment_complement_items (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT Complemento de Pago 2.0: per-DoctoRelacionado tax breakdown (ImpuestosP)';

SET FOREIGN_KEY_CHECKS = 1;
