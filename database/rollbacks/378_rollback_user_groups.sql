-- Rollback 378: User groups
-- Drops the group linkage and the kind column. The enum widenings are left in
-- place: shrinking an ENUM with live rows using the new values would corrupt
-- data ('readonly' users / 'support' memberships written after 378), and the
-- wider enums are harmless to pre-378 code.
-- INFORMATION_SCHEMA-guarded (per the 371/374 rollback convention) so a re-run
-- or a rollback of a partially applied 378 completes instead of aborting on
-- the first already-dropped object.
DROP PROCEDURE IF EXISTS rollback_378_user_groups;
DELIMITER //
CREATE PROCEDURE rollback_378_user_groups()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND CONSTRAINT_NAME = 'fk_users_group'
  ) THEN
    ALTER TABLE users DROP FOREIGN KEY fk_users_group;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'group_id'
  ) THEN
    ALTER TABLE users DROP COLUMN group_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'roles'
      AND COLUMN_NAME  = 'kind'
  ) THEN
    ALTER TABLE roles DROP COLUMN kind;
  END IF;
END //
DELIMITER ;
CALL rollback_378_user_groups();
DROP PROCEDURE IF EXISTS rollback_378_user_groups;
