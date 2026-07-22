-- =============================================================================
-- Migration 412 — backfill organization_mx_profiles.pac_environment
-- =============================================================================
-- cfdiService now scopes PAC stamping/cancellation to the org's fiscal
-- environment (organization_mx_profiles.pac_environment). That column was added
-- in migration 067 with DEFAULT 'sandbox' but nothing ever wrote it, so every
-- existing org reads 'sandbox'. Without this backfill, an org already running
-- LIVE (its only active PAC is environment='production') would suddenly match
-- ZERO providers and stop stamping on deploy.
--
-- Derive the switch from what the org is actually running: set 'production' only
-- when it has an active production PAC and NO active sandbox PAC — i.e. the
-- environment is unambiguous. Mixed or sandbox-only orgs keep 'sandbox' (safe:
-- an admin explicitly opts into production via the PAC-providers screen). This
-- is a data-only, idempotent UPDATE (re-running sets the same value); no schema
-- change, so database/schema.sql is unchanged.
-- =============================================================================

UPDATE organization_mx_profiles p
   SET p.pac_environment = 'production'
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
