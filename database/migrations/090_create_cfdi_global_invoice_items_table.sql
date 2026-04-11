-- Migration: 090_create_cfdi_global_invoice_items_table
-- Description: Junction table linking individual invoices from "público en
--              general" clients (requires_cfdi = FALSE) to their parent CFDI
--              Global (Factura Global) document.
--
--              Each invoice may belong to at most one CFDI Global (enforced by
--              the UNIQUE constraint on invoice_id).  Once a Factura Global is
--              stamped, the linked invoices are considered fiscally reported to
--              the SAT through that aggregated document.
--
--              Only invoices belonging to MX-locale clients whose
--              client_mx_profiles.requires_cfdi = FALSE should be linked here.
--              This rule is enforced at the application layer, not via triggers,
--              to keep the migration simple and avoid cross-table trigger chains.

-- Disable FK checks: referenced tables may be created in other migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS cfdi_global_invoice_items (
    id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    cfdi_global_invoice_id      BIGINT UNSIGNED NOT NULL
                                    COMMENT 'Parent CFDI Global document this invoice is aggregated into',
    invoice_id                  BIGINT UNSIGNED NOT NULL
                                    COMMENT 'Individual invoice from a público en general client',

    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_cfdi_global_invoice_items_invoice (invoice_id),
    KEY idx_cfdi_global_invoice_items_global_id (cfdi_global_invoice_id),

    CONSTRAINT fk_cfdi_global_invoice_items_global FOREIGN KEY (cfdi_global_invoice_id)
        REFERENCES cfdi_global_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_global_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Links individual invoices to their parent CFDI Global (Factura Global) — each invoice belongs to at most one CFDI Global';

SET FOREIGN_KEY_CHECKS = 1;
