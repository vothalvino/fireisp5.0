-- Rollback 462 — restore the legacy insert default.
-- Existing rows remain inactive: their pre-migration state cannot be inferred,
-- and silently reactivating access controls during rollback would risk lockout.

ALTER TABLE admin_ip_allowlist
  MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
