-- Migration: 189_align_radius_password_column
-- Description: Aligns the radius table with the code contract and the FreeRADIUS
--              SQL configuration (see database/freeradius/README.md). PPPoE
--              authentication uses PAP/CHAP, which requires the cleartext
--              subscriber secret — FreeRADIUS reads it via:
--                  authorize_check_query: SELECT r.password ... 'Cleartext-Password'
--              The Radius model already declares a `password` fillable column, but
--              the original schema (migration 008) named the column `password_hash`.
--              This migration renames `password_hash` -> `password` so the column
--              name matches the model, the validation schema, and the FreeRADIUS
--              lookup. The value is stored as a recoverable cleartext PPPoE secret
--              so operators can view it for future use.
--
--              Guarded with INFORMATION_SCHEMA checks so the migration is a safe
--              no-op when re-run or when the column is already named `password`.

SET @db_name = DATABASE();

SET @has_password_hash = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'radius'
    AND COLUMN_NAME = 'password_hash'
);

SET @has_password = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'radius'
    AND COLUMN_NAME = 'password'
);

SET @sql = IF(
  @has_password_hash = 1 AND @has_password = 0,
  'ALTER TABLE radius CHANGE COLUMN password_hash password VARCHAR(255) NOT NULL COMMENT ''Cleartext PPPoE secret used by FreeRADIUS Cleartext-Password lookups; kept visible for operator reference''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
