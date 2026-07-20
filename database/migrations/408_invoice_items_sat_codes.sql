-- =============================================================================
-- Migration 408 — Per-line SAT catalog codes on invoice_items (stamp-later)
-- =============================================================================
-- Converting an invoice into a CFDI 4.0 (cfdi_conceptos) requires a SAT
-- product/service code (c_ClaveProdServ) and unit code (c_ClaveUnidad) per
-- line. invoice_items had no source for either — nothing on plans or
-- inventory_items maps to the SAT catalogs.
--
-- Nullable by design: the stamp-later conversion falls back to the ISP
-- defaults (81161700 "Servicios de acceso a internet", E48 "Unidad de
-- servicio" — both already seeded in sat_clave_prod_serv / sat_clave_unidad)
-- when a line carries no explicit code, so existing invoices stamp without
-- backfill. Global-locale orgs never populate these.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_408_invoice_items_sat_codes;
DELIMITER //
CREATE PROCEDURE migration_408_invoice_items_sat_codes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND COLUMN_NAME  = 'clave_prod_serv'
  ) THEN
    ALTER TABLE invoice_items
      ADD COLUMN clave_prod_serv VARCHAR(10) NULL
        COMMENT 'SAT c_ClaveProdServ for CFDI conversion; NULL = org default (81161700)'
        AFTER inventory_item_id,
      ADD COLUMN clave_unidad VARCHAR(5) NULL
        COMMENT 'SAT c_ClaveUnidad for CFDI conversion; NULL = org default (E48)'
        AFTER clave_prod_serv;
  END IF;
END //
DELIMITER ;
CALL migration_408_invoice_items_sat_codes();
DROP PROCEDURE IF EXISTS migration_408_invoice_items_sat_codes;
