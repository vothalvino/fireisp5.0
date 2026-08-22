-- Migration 462 — make the admin IP allowlist an explicit GUI opt-in
--
-- Before database-backed enforcement existed, POST defaulted is_active to 1
-- even though the value did not control access. Do not reinterpret those
-- historical/display-only rows as consent to activate a lockout policy.

ALTER TABLE admin_ip_allowlist
  MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 0;

UPDATE admin_ip_allowlist
SET is_active = 0
WHERE is_active <> 0;
