-- Migration: 085_create_cfdi_concepto_impuestos_table
-- Description: Per-line tax breakdown for CFDI 4.0 concepts.  SAT requires
--              explicit <Traslados> and <Retenciones> nodes inside each <Concepto>
--              when objeto_imp = '02'.  Each row in this table maps to one
--              <Traslado> or <Retencion> element for a specific concept.
--
--              Common combinations for ISPs:
--                traslado / 002 / Tasa / 0.160000 — IVA 16 %
--                traslado / 002 / Tasa / 0.000000 — IVA 0 % (tasa cero)
--                traslado / 002 / Exento / NULL   — IVA exento
--                retencion / 001 / Tasa / 0.100000 — ISR retención 10 %
--                retencion / 002 / Tasa / 0.106667 — IVA retención 2/3 partes

-- Disable FK checks: cfdi_conceptos is created in migration 083.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_concepto_impuestos (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,

    -- Parent concept
    cfdi_concepto_id    BIGINT UNSIGNED     NOT NULL
                            COMMENT 'CFDI concept (line item) this tax row belongs to',

    -- Tax classification
    tax_type            ENUM('traslado', 'retencion') NOT NULL
                            COMMENT 'traslado = tax transferred to the buyer (IVA, IEPS); retencion = withholding retained from the supplier (ISR, IVA retencion)',
    impuesto            VARCHAR(3)          NOT NULL
                            COMMENT 'SAT tax code: 001=ISR, 002=IVA, 003=IEPS',
    tipo_factor         ENUM('Tasa', 'Cuota', 'Exento') NOT NULL DEFAULT 'Tasa'
                            COMMENT 'Rate type: Tasa=percentage rate, Cuota=fixed quota per unit, Exento=exempt (no tax)',

    -- Rate and amounts
    tasa_o_cuota        DECIMAL(8, 6)       NULL
                            COMMENT 'Tax rate or quota (e.g. 0.160000 for IVA 16 %); NULL when tipo_factor = Exento',
    base                DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Taxable base amount for this line (importe - descuento of the parent concept)',
    importe             DECIMAL(14, 4)      NULL
                            COMMENT 'Calculated tax amount: base × tasa_o_cuota; NULL when tipo_factor = Exento',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_ci_cfdi_concepto_id (cfdi_concepto_id),
    KEY idx_cfdi_ci_tax_type (tax_type),
    KEY idx_cfdi_ci_impuesto (impuesto),

    CONSTRAINT fk_cfdi_ci_cfdi_concepto FOREIGN KEY (cfdi_concepto_id)
        REFERENCES cfdi_conceptos (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-line tax breakdown for CFDI 4.0 — one row per <Traslado> or <Retencion> inside a <Concepto>';

SET FOREIGN_KEY_CHECKS = 1;
