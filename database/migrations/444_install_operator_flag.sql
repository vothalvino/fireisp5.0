-- =============================================================================
-- Migration 444 — mark the INSTALL OPERATOR explicitly (j56)
-- =============================================================================
-- FireISP had no way to say "this account runs the box". Code that needed the
-- idea used `users.role = 'admin'`, which cannot express it: `roles` is a
-- GLOBAL table, migration 378 marks both the `admin` and `super_admin` groups
-- kind='admin', and User.resolveGroupMirror copies group.kind into users.role —
-- so EVERY organisation's admin carries it. That let any tenant admin rewrite
-- install-wide settings and trigger a host redeploy.
--
-- An earlier attempt inferred the operator from the number of organisations on
-- the install. That was worse than it looked: the count moves. The ordinary
-- onboarding move (create your real organisation, delete the seeded demo one)
-- left a soft-deleted row behind, and the box owner silently and permanently
-- lost the update button with a bare 404 — no attacker required. Any inferred
-- signal has this shape, so this migration stops inferring and stores the fact.
--
-- WHO GETS IT HERE depends on the shape of the install, decided ONCE at
-- migration time (a one-off judgement about existing data, not a rule the
-- runtime re-derives — that mistake is described above):
--
--   * ONE organisation — every active legacy admin keeps the capability they
--     have today. They all work for the ISP that owns the box; there is no
--     other tenant for them to be dangerous to, and silently demoting an
--     operator's colleagues on upgrade would break working installs for no
--     security gain.
--   * MORE THAN ONE organisation — only the OLDEST active legacy admin, who
--     is whoever set the box up, ahead of any tenant onboarded later. This is
--     where "any admin" stops being a safe answer.
--
-- Nobody GAINS anything either way: every one of these accounts already passed
-- the old `role = 'admin'` check. The flag only stops everyone else passing it.
-- If it lands on the wrong account, INSTALL_OPERATOR_USER_IDS overrides it
-- without a migration.
--
-- The column is not in User.fillable and is not accepted by any validation
-- schema, so it cannot be granted through the API at all. It is set here, by
-- the seeder for a fresh install, or by hand with INSTALL_OPERATOR_USER_IDS in
-- the environment.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_444_install_operator_flag;
DELIMITER //
CREATE PROCEDURE migration_444_install_operator_flag()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'is_install_operator'
  ) THEN
    ALTER TABLE users
      ADD COLUMN is_install_operator TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Runs this INSTALL (deploy, install-wide settings) — NOT a tenant role. Never settable through the API: absent from User.fillable and from every validation schema (migration 444).';

    SET @fireisp_org_count = (SELECT COUNT(*) FROM organizations WHERE deleted_at IS NULL);

    IF @fireisp_org_count <= 1 THEN
      UPDATE users
         SET is_install_operator = 1
       WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL;
    ELSE
      -- LIMIT inside a correlated subquery is not allowed, so the id is
      -- resolved into a variable first.
      SET @fireisp_install_operator_id = (
        SELECT id FROM users
         WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1
      );
      IF @fireisp_install_operator_id IS NOT NULL THEN
        UPDATE users SET is_install_operator = 1 WHERE id = @fireisp_install_operator_id;
      END IF;
    END IF;
  END IF;
END //
DELIMITER ;

CALL migration_444_install_operator_flag();
DROP PROCEDURE IF EXISTS migration_444_install_operator_flag;
