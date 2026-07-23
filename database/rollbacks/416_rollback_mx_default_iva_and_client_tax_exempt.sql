-- Rollback 416 — reverse the client IVA-exemption columns and the seeded MX
-- default IVA rates.
-- Column drops are guarded so the rollback is idempotent.

DROP PROCEDURE IF EXISTS rollback_416_client_tax_exempt;
DELIMITER //
CREATE PROCEDURE rollback_416_client_tax_exempt()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'tax_exempt'
  ) THEN
    ALTER TABLE clients DROP COLUMN tax_exempt, DROP COLUMN tax_exempt_reason;
  END IF;
END //
DELIMITER ;
CALL rollback_416_client_tax_exempt();
DROP PROCEDURE IF EXISTS rollback_416_client_tax_exempt;

-- Remove only rows this migration seeded AND left UNTOUCHED: exact name, the
-- exact seeded rate (0.1600 — so an org that edited it, e.g. to 8% for the
-- border region, is never deleted), and the exact seeded description prefix.
-- The literal '%' in the description is escaped (ESCAPE '\'); the trailing '%'
-- is the wildcard. Skip any row still referenced by ANY of the six tax_rate_id
-- FKs (all ON DELETE SET NULL, so an unguarded delete would silently null live
-- references rather than error).
DELETE t FROM tax_rates t
WHERE t.name = 'IVA 16%'
  AND t.rate = 0.1600
  AND t.description LIKE 'Impuesto al Valor Agregado 16\% — default for this Mexican organization (migration 416).%' ESCAPE '\'
  AND NOT EXISTS (SELECT 1 FROM invoices i           WHERE i.tax_rate_id  = t.id)
  AND NOT EXISTS (SELECT 1 FROM quotes q             WHERE q.tax_rate_id  = t.id)
  AND NOT EXISTS (SELECT 1 FROM invoice_items ii     WHERE ii.tax_rate_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM quote_items qi       WHERE qi.tax_rate_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM credit_notes cn      WHERE cn.tax_rate_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM credit_note_items ci WHERE ci.tax_rate_id = t.id);
