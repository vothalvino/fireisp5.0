-- =============================================================================
-- Migration 378 — User groups: assignable permission groups for staff accounts
-- =============================================================================
-- UCRM-style user groups: the existing `roles` table becomes the reusable
-- "user group" concept, and staff users (the `users` table — never clients)
-- are linked to exactly one group via a real FK instead of the fixed
-- users.role name-ENUM ("user type"), which migration 049 deferred and no
-- migration ever added.
--
--   * roles.kind — which built-in persona a group is BASED ON. Drives the
--     coarse frontend surface (nav sections, technician dashboard) and the
--     users.role mirror; actual authorization is the group's permission set.
--     Only system groups may have kind 'admin' (an admin-kind user passes the
--     legacy RBAC bypass, so a custom group with kind admin would ignore its
--     own permission list — enforced app-side in the roles schema/routes).
--   * users.group_id — the user's group. Backfilled from the legacy
--     users.role name so existing accounts keep their exact permissions.
--     users.role stays as a synced mirror of the group's kind: ~40 backend
--     and ~35 frontend call sites key on the legacy name and keep working
--     unchanged while group_id becomes the authoritative permission source
--     (see User.getPermissions).
--   * users.role gains 'readonly' so readonly-kind groups can be mirrored
--     (also unbreaks `admin.js create-user --role readonly`, which offered a
--     value the enum rejected).
--   * organization_users.role gains 'support' so membership rows can mirror
--     support-kind groups (support previously worked only via the legacy
--     users.role fallback).
--
-- All ALTERs are INFORMATION_SCHEMA-guarded (idempotent re-runs on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_378_user_groups;
DELIMITER //
CREATE PROCEDURE migration_378_user_groups()
BEGIN
  -- 1. roles.kind — persona a group is based on
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'kind') THEN
    ALTER TABLE roles
      ADD COLUMN kind ENUM('admin','billing','support','technician','readonly') NULL DEFAULT NULL
        COMMENT 'Persona this group is based on: coarse UI surface + users.role mirror; NULL only for pre-378 rows'
        AFTER description;
  END IF;

  -- 2. users.role — allow mirroring readonly-kind groups
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role' AND COLUMN_TYPE LIKE '%''readonly''%') THEN
    ALTER TABLE users
      MODIFY COLUMN role ENUM('admin','billing','support','technician','readonly') NOT NULL DEFAULT 'support';
  END IF;

  -- 3. organization_users.role — allow mirroring support-kind groups
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'organization_users' AND COLUMN_NAME = 'role' AND COLUMN_TYPE LIKE '%''support''%') THEN
    ALTER TABLE organization_users
      MODIFY COLUMN role ENUM('owner','admin','manager','technician','billing','readonly','support')
        NOT NULL DEFAULT 'readonly'
        COMMENT 'User role within this specific organization';
  END IF;

  -- 4. users.group_id — the user's group (staff only; clients are unaffected)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users' AND COLUMN_NAME = 'group_id') THEN
    ALTER TABLE users
      ADD COLUMN group_id BIGINT UNSIGNED NULL DEFAULT NULL
        COMMENT 'FK to roles: the user group whose permission set governs this staff account'
        AFTER role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users' AND CONSTRAINT_NAME = 'fk_users_group') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_group FOREIGN KEY (group_id)
        REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END//
DELIMITER ;
CALL migration_378_user_groups();
DROP PROCEDURE IF EXISTS migration_378_user_groups;

-- ---------------------------------------------------------------------------
-- 5. Backfill kinds for the built-in groups (system roles)
-- ---------------------------------------------------------------------------
UPDATE roles SET kind = 'admin'      WHERE name IN ('admin', 'super_admin')   AND kind IS NULL;
UPDATE roles SET kind = 'billing'    WHERE name IN ('billing', 'reseller_admin') AND kind IS NULL;
UPDATE roles SET kind = 'support'    WHERE name = 'support'                   AND kind IS NULL;
UPDATE roles SET kind = 'technician' WHERE name IN ('technician', 'noc_operator') AND kind IS NULL;
UPDATE roles SET kind = 'readonly'   WHERE name IN ('readonly', 'auditor')    AND kind IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Backfill users.group_id, preserving each account's PRE-378 effective
--    permissions. Pre-378 resolution order was: organization_users.role for
--    the org (when it named a live role) FIRST, users.role only as fallback.
--    SSO-provisioned accounts always have users.role='support' while their
--    membership carries the mapped role (admin/billing/...), so backfilling
--    from users.role alone would silently rewrite their permissions.
--
-- 6a. Primary source: the user's home-org membership role, when it names a
--     live role (owner/manager have no roles row and fall through, exactly
--     like the pre-378 resolution did).
-- ---------------------------------------------------------------------------
UPDATE users u
JOIN organization_users ou
  ON ou.user_id = u.id AND ou.organization_id = u.organization_id AND ou.deleted_at IS NULL
JOIN roles r ON r.name = ou.role AND r.deleted_at IS NULL
SET u.group_id = r.id
WHERE u.group_id IS NULL;

-- 6b. Fallback: the legacy users.role name (accounts without a resolvable
--     membership — admin-UI-created users, single-tenant installs).
UPDATE users u
JOIN roles r ON r.name = u.role AND r.deleted_at IS NULL
SET u.group_id = r.id
WHERE u.group_id IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Sync the legacy users.role mirror to the assigned group's kind (the
--    invariant the application maintains from here on). For SSO accounts this
--    aligns users.role with the role that was already authoritative pre-378.
-- ---------------------------------------------------------------------------
UPDATE users u
JOIN roles g ON g.id = u.group_id
SET u.role = g.kind
WHERE g.kind IS NOT NULL AND u.role != g.kind;
