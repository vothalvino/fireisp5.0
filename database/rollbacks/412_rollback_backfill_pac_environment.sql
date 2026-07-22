-- Rollback 412 — revert the pac_environment backfill.
-- The migration only touched orgs whose active PACs were production-only; those
-- rows held the column default 'sandbox' beforehand (nothing wrote the column
-- prior to migration 412), so restoring the same predicate to 'sandbox' returns
-- the pre-migration state. NOTE: if an admin has since deliberately set
-- pac_environment via the app, this reverts that choice too — re-set it after
-- rolling back.
UPDATE organization_mx_profiles p
   SET p.pac_environment = 'sandbox'
 WHERE p.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM pac_providers pp
      WHERE pp.organization_id = p.organization_id
        AND pp.status = 'active' AND pp.deleted_at IS NULL
        AND pp.environment = 'production')
   AND NOT EXISTS (
     SELECT 1 FROM pac_providers pp
      WHERE pp.organization_id = p.organization_id
        AND pp.status = 'active' AND pp.deleted_at IS NULL
        AND pp.environment = 'sandbox');
