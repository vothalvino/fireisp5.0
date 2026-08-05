-- Rollback for migration 446 — MX fiscal data at lead intake
ALTER TABLE leads
  DROP COLUMN rfc,
  DROP COLUMN curp,
  DROP COLUMN razon_social,
  DROP COLUMN regimen_fiscal,
  DROP COLUMN codigo_postal_fiscal;
