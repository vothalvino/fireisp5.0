-- Migration 461 — installation-wide WireGuard activation switch.
-- `migrate` is a one-time sentinel: the first new runtime imports the legacy
-- WG_SERVER_ENABLED behavior, persists true/false, and never consults the env
-- again. This preserves an existing hub without making upgraded installs opt in.
INSERT INTO settings (setting_key, setting_value, description) VALUES
  ('wireguard_server_enabled',
   'migrate',
   'Enable the managed WireGuard hub. The isolated networking helper owns NET_ADMIN; the web/API app remains non-root. Fresh installs use private randomly generated UDP ports.')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
