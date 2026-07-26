-- =============================================================================
-- Migration 425 — Give device_config_backups and recurring_payment_profiles an
--                 organization_id, so BaseModel can actually scope them
-- =============================================================================
-- Both tables are exposed through a generic crudController mounted over a model
-- that declares `hasOrgScope = false`. src/models/BaseModel.js:99 reads
--
--     if (orgId !== null && this.hasOrgScope) { conditions.push('organization_id = ?') }
--
-- so the org filter is SILENTLY OMITTED rather than raising — no error, no log,
-- no failing test. The same absent predicate flows into update/delete/restore,
-- so this was cross-tenant WRITE as well as read.
--
-- What was reachable:
--
--   * device_config_backups.content is `LONGTEXT COMMENT 'Full configuration
--     text'` — complete RouterOS exports, which carry PPPoE and RADIUS secrets,
--     admin credentials, SNMP communities, WireGuard keys and customer queue
--     trees. Any tenant's technician or NOC operator could read, and delete,
--     every other tenant's.
--
--   * recurring_payment_profiles holds token_reference and stripe_customer_id.
--     Its model even documented the gap as intentional ("single-tenant
--     deployment") while the product ships reseller scoping. Note this is a PII
--     and enumeration exposure rather than a payment one: every charge decrypts
--     the OWNING org's secret key (checkoutService.js, paymentGatewayService.js),
--     so a leaked token is not chargeable by another tenant.
--
-- WHY A COLUMN RATHER THAN A PARENT JOIN. The repo already contains the JOIN
-- alternative at src/models/Radius.js:66-133, and it demonstrates the problem
-- with it: it overrides findById, findAll and count — the READ paths — and
-- leaves update, delete and restore inherited and unscoped. Scoping by column
-- means one `hasOrgScope` flag covers all six operations in BaseModel, instead
-- of six per-model overrides that must each remember an UPDATE ... JOIN.
--
-- Denormalisation is safe here: a config backup belongs to the tenant that
-- owned the device WHEN IT WAS TAKEN, and an autopay profile to the tenant that
-- owned the client when it was created. If a device were ever reassigned, the
-- historical backup staying with the original org is the correct answer, not a
-- stale one.
--
-- NOT NULL is deliberate. A nullable column would let a row with a NULL org sit
-- invisible to every tenant — the same silent class this migration closes.
-- Backfill runs before the constraint tightens. Orphans should not exist either
-- way — device_config_backups cascades from devices, and recurring_payment_
-- profiles RESTRICTs client deletion outright — so the DELETE below is a safety
-- net for hand-edited data, not an expected path.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_425_org_scope_leaky_tables;
DELIMITER //
CREATE PROCEDURE migration_425_org_scope_leaky_tables()
BEGIN
  -- ── device_config_backups → devices.organization_id ────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'device_config_backups'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    -- Added nullable so the backfill can run, then tightened below.
    ALTER TABLE device_config_backups
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from devices (migration 425)'
          AFTER id;

    UPDATE device_config_backups b
      JOIN devices d ON d.id = b.device_id
       SET b.organization_id = d.organization_id;

    -- Any row whose device disappeared without cascading is unattributable and
    -- was already unreachable through the API; drop it rather than block the
    -- NOT NULL below with a row nobody can see or own.
    DELETE FROM device_config_backups WHERE organization_id IS NULL;

    ALTER TABLE device_config_backups
      MODIFY COLUMN organization_id BIGINT UNSIGNED NOT NULL
          COMMENT 'Owning org, denormalised from devices (migration 425)',
      ADD KEY idx_dcb_org (organization_id, device_id, created_at DESC),
      ADD CONSTRAINT fk_dcb_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- ── recurring_payment_profiles → clients.organization_id ───────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE recurring_payment_profiles
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from clients (migration 425)'
          AFTER id;

    UPDATE recurring_payment_profiles p
      JOIN clients c ON c.id = p.client_id
       SET p.organization_id = c.organization_id;

    DELETE FROM recurring_payment_profiles WHERE organization_id IS NULL;

    ALTER TABLE recurring_payment_profiles
      MODIFY COLUMN organization_id BIGINT UNSIGNED NOT NULL
          COMMENT 'Owning org, denormalised from clients (migration 425)',
      ADD KEY idx_rpp_org (organization_id, client_id),
      ADD CONSTRAINT fk_rpp_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;

CALL migration_425_org_scope_leaky_tables();
DROP PROCEDURE IF EXISTS migration_425_org_scope_leaky_tables;
