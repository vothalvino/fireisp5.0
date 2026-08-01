-- =============================================================================
-- Migration 440 — org-scope snmp_profiles, and lock the ones that ship
-- =============================================================================
-- Continues the BaseModel org-scoping sweep (425 device_config_backups +
-- recurring_payment_profiles, 426 radius, 429 sla_definitions, 435
-- scheduled_tasks, 437 outages, 438 speed_tests).
--
-- src/models/SnmpProfile.js declares hasOrgScope = false and the table has no
-- organization_id, so every verb behind the generic crudController ran
-- unscoped: any tenant could read, rewrite or DELETE another tenant's polling
-- profiles. A profile decides which OIDs are polled from which devices, so a
-- hostile or careless edit silently blinds another ISP's monitoring — the
-- damage is to observability, which is exactly the thing you would rely on to
-- notice it.
--
-- TWO KINDS OF PROFILE, and the distinction is the point of this migration.
--
--   SYSTEM profiles (is_system = 1, organization_id NULL) — the vendor library
--   that ships with FireISP: Generic IF-MIB, Ubiquiti airOS, MikroTik RouterOS,
--   Cambium, Mimosa, Tarana, Radwin, Siklu. Visible to every tenant, editable
--   by NONE. They are product content, not customer data: letting one tenant
--   retune "MikroTik RouterOS" would change what every other tenant polls, and
--   an accidental delete would break polling install-wide with no way back
--   short of re-running the seed.
--
--   TENANT profiles (is_system = 0) — created through the API, owned by the
--   org that created them, invisible to everyone else.
--
-- WHY MATCH ON NAME rather than "everything that exists right now": an operator
-- who already created custom profiles before this migration must not have them
-- locked. Only the eight names FireISP itself seeds are marked system; anything
-- else becomes an unattributed legacy row (organization_id NULL), visible to
-- all and ADOPTED by the first tenant that writes to it — the same treatment
-- outages and speed_tests got, for the same reason.
--
-- THE UNIQUE KEY HAS TO WIDEN. uq_snmp_profiles_name is (name, active_flag),
-- i.e. install-wide. Once profiles are per-tenant that means org B cannot
-- create a profile with a name org A already used, surfacing as a confusing
-- duplicate-key 500 rather than anything an operator could act on. It becomes
-- (organization_id, name, active_flag).
--
-- active_flag is a GENERATED column — referenced in the index only, never
-- written, because MySQL rejects any explicit value for one.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_440_org_scope_snmp_profiles;
DELIMITER //
CREATE PROCEDURE migration_440_org_scope_snmp_profiles()
BEGIN
  -- A leftover index from a previous rollback would make ADD KEY fail with
  -- ER_DUP_KEYNAME: dropping a column does not drop an index containing it.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND INDEX_NAME = 'idx_snmp_profiles_org'
  ) THEN
    ALTER TABLE snmp_profiles DROP INDEX idx_snmp_profiles_org;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE snmp_profiles
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org. NULL = a system profile (is_system=1) or an unattributed legacy row, adoptable on write (migration 440)'
          AFTER id,
      ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE
          COMMENT 'Ships with FireISP: visible to every tenant, editable by none (migration 440)'
          AFTER organization_id;

    -- The library FireISP seeds. Matched by name so an operator's own
    -- pre-existing profiles are NOT locked.
    UPDATE snmp_profiles
       SET is_system = TRUE, organization_id = NULL
     WHERE name IN ('Generic IF-MIB', 'Ubiquiti airOS', 'MikroTik RouterOS',
                    'Cambium Networks', 'Mimosa Networks', 'Tarana Wireless',
                    'Radwin', 'Siklu');

    ALTER TABLE snmp_profiles
      ADD KEY idx_snmp_profiles_org (organization_id, status),
      ADD CONSTRAINT fk_snmp_profiles_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Separate guard: an install could have the columns but the old key.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND INDEX_NAME = 'uq_snmp_profiles_name'
      AND COLUMN_NAME = 'name' AND SEQ_IN_INDEX = 1
  ) THEN
    ALTER TABLE snmp_profiles DROP INDEX uq_snmp_profiles_name;
    ALTER TABLE snmp_profiles
      ADD UNIQUE KEY uq_snmp_profiles_name (organization_id, name, active_flag);
  END IF;
END //
DELIMITER ;

CALL migration_440_org_scope_snmp_profiles();
DROP PROCEDURE IF EXISTS migration_440_org_scope_snmp_profiles;
