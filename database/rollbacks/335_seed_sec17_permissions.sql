-- Rollback 335 — §17 Security permissions seed and new roles
-- role_permissions rows cascade via FK when permission rows are deleted
DELETE FROM permissions WHERE name IN (
  'webauthn.view','webauthn.create','webauthn.delete',
  'admin_ip_allowlist.view','admin_ip_allowlist.create','admin_ip_allowlist.update','admin_ip_allowlist.delete',
  'password_policy.view','password_policy.update',
  'api_key_rate_limits.view','api_key_rate_limits.update',
  'firewall_rules.view','firewall_rules.create','firewall_rules.update','firewall_rules.delete',
  'ddos_protection.view','ddos_protection.create','ddos_protection.update','ddos_protection.delete',
  'blackhole_routes.view','blackhole_routes.create','blackhole_routes.update','blackhole_routes.delete',
  'dns_blocklists.view','dns_blocklists.create','dns_blocklists.update','dns_blocklists.delete',
  'cpe_security_scans.view','cpe_security_scans.create',
  'encryption_keys.view','encryption_keys.update',
  'data_masking.view','data_masking.update',
  'secure_deletion.view','secure_deletion.run'
);
DELETE FROM roles WHERE name IN ('super_admin','noc_operator','reseller_admin','auditor');
