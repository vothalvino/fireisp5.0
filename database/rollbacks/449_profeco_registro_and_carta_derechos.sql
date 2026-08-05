-- Rollback for migration 449 — PROFECO registro + Carta de Derechos URL
ALTER TABLE organization_mx_profiles
  DROP COLUMN profeco_registro,
  DROP COLUMN carta_derechos_url;
