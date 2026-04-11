-- Migration: 090_create_factura_publica_invoice_items_table
-- Description: Junction table linking individual invoices from contracts with
--              facturar = FALSE to their parent factura pública (venta al
--              público en general) document.
--
--              Each invoice may belong to at most one factura pública (enforced
--              by the UNIQUE constraint on invoice_id).  Once a factura pública
--              is stamped, the linked invoices are considered fiscally reported
--              to the SAT through that aggregated document.
--
--              Only invoices from MX-locale contracts with facturar = FALSE
--              should be linked here.  This rule is enforced at the application
--              layer, not via triggers, to keep the migration simple and avoid
--              cross-table trigger chains.

-- Disable FK checks: referenced tables may be created in other migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS factura_publica_invoice_items (
    id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    factura_publica_invoice_id      BIGINT UNSIGNED NOT NULL
                                        COMMENT 'Parent factura pública document this invoice is aggregated into',
    invoice_id                      BIGINT UNSIGNED NOT NULL
                                        COMMENT 'Individual invoice from a contract with facturar = FALSE',

    created_at                      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_factura_publica_invoice_items_invoice (invoice_id),
    KEY idx_factura_publica_invoice_items_parent_id (factura_publica_invoice_id),

    CONSTRAINT fk_factura_publica_invoice_items_parent FOREIGN KEY (factura_publica_invoice_id)
        REFERENCES factura_publica_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_factura_publica_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Links individual invoices to their parent factura pública — each invoice belongs to at most one factura pública';

SET FOREIGN_KEY_CHECKS = 1;
