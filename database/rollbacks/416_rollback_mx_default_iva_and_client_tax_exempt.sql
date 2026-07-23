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

-- Remove only the rows this migration seeded (matched by the exact description),
-- and only when no invoice/quote still references them.
DELETE t FROM tax_rates t
WHERE t.name = 'IVA 16%'
  AND t.description LIKE 'Impuesto al Valor Agregado 16%% — default for this Mexican organization (migration 416).%'
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tax_rate_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.tax_rate_id = t.id);
