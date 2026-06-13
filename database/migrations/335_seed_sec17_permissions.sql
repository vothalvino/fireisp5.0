-- Migration 335 — §17 Security permissions seed and new roles
-- Purpose: Seed all §17 Security & Access Control permissions; add super_admin, noc_operator, reseller_admin, auditor roles.
-- Tables: permissions, role_permissions, roles (seed only)

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- New roles (§17)
-- ---------------------------------------------------------------------------
INSERT INTO roles (name, description, is_system)
SELECT 'super_admin', 'Super administrator — full system access including security settings', TRUE
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'super_admin');

INSERT INTO roles (name, description, is_system)
SELECT 'noc_operator', 'NOC operator — network monitoring, device management, and incident response', TRUE
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'noc_operator');

INSERT INTO roles (name, description, is_system)
SELECT 'reseller_admin', 'Reseller administrator — manage reseller customers and billing', TRUE
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'reseller_admin');

INSERT INTO roles (name, description, is_system)
SELECT 'auditor', 'Read-only auditor — view all resources for compliance and audit purposes', TRUE
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'auditor');

-- ---------------------------------------------------------------------------
-- Module: security — webauthn
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'webauthn.view', 'View registered WebAuthn/FIDO2 hardware key credentials', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webauthn.view');

INSERT INTO permissions (name, description, module)
SELECT 'webauthn.create', 'Register new WebAuthn/FIDO2 hardware key credentials', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webauthn.create');

INSERT INTO permissions (name, description, module)
SELECT 'webauthn.delete', 'Revoke registered WebAuthn/FIDO2 hardware key credentials', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webauthn.delete');

-- ---------------------------------------------------------------------------
-- Module: security — admin_ip_allowlist
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'admin_ip_allowlist.view', 'View admin IP allowlist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'admin_ip_allowlist.view');

INSERT INTO permissions (name, description, module)
SELECT 'admin_ip_allowlist.create', 'Add entries to the admin IP allowlist', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'admin_ip_allowlist.create');

INSERT INTO permissions (name, description, module)
SELECT 'admin_ip_allowlist.update', 'Edit admin IP allowlist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'admin_ip_allowlist.update');

INSERT INTO permissions (name, description, module)
SELECT 'admin_ip_allowlist.delete', 'Remove admin IP allowlist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'admin_ip_allowlist.delete');

-- ---------------------------------------------------------------------------
-- Module: security — password_policy
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'password_policy.view', 'View organization password policy configuration', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'password_policy.view');

INSERT INTO permissions (name, description, module)
SELECT 'password_policy.update', 'Update organization password policy configuration', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'password_policy.update');

-- ---------------------------------------------------------------------------
-- Module: security — api_key_rate_limits
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'api_key_rate_limits.view', 'View per-API-key rate limit configurations', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_key_rate_limits.view');

INSERT INTO permissions (name, description, module)
SELECT 'api_key_rate_limits.update', 'Update per-API-key rate limit configurations', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_key_rate_limits.update');

-- ---------------------------------------------------------------------------
-- Module: security — firewall_rules
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'firewall_rules.view', 'View network firewall rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'firewall_rules.view');

INSERT INTO permissions (name, description, module)
SELECT 'firewall_rules.create', 'Create network firewall rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'firewall_rules.create');

INSERT INTO permissions (name, description, module)
SELECT 'firewall_rules.update', 'Update network firewall rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'firewall_rules.update');

INSERT INTO permissions (name, description, module)
SELECT 'firewall_rules.delete', 'Delete network firewall rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'firewall_rules.delete');

-- ---------------------------------------------------------------------------
-- Module: security — ddos_protection
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'ddos_protection.view', 'View DDoS protection rules and status', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ddos_protection.view');

INSERT INTO permissions (name, description, module)
SELECT 'ddos_protection.create', 'Create DDoS protection rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ddos_protection.create');

INSERT INTO permissions (name, description, module)
SELECT 'ddos_protection.update', 'Update DDoS protection rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ddos_protection.update');

INSERT INTO permissions (name, description, module)
SELECT 'ddos_protection.delete', 'Delete DDoS protection rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ddos_protection.delete');

-- ---------------------------------------------------------------------------
-- Module: security — blackhole_routes
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'blackhole_routes.view', 'View active and historical blackhole routes', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'blackhole_routes.view');

INSERT INTO permissions (name, description, module)
SELECT 'blackhole_routes.create', 'Create blackhole routes', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'blackhole_routes.create');

INSERT INTO permissions (name, description, module)
SELECT 'blackhole_routes.update', 'Update blackhole route entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'blackhole_routes.update');

INSERT INTO permissions (name, description, module)
SELECT 'blackhole_routes.delete', 'Remove blackhole route entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'blackhole_routes.delete');

-- ---------------------------------------------------------------------------
-- Module: security — dns_blocklists
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'dns_blocklists.view', 'View DNS blocklist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dns_blocklists.view');

INSERT INTO permissions (name, description, module)
SELECT 'dns_blocklists.create', 'Add entries to DNS blocklists', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dns_blocklists.create');

INSERT INTO permissions (name, description, module)
SELECT 'dns_blocklists.update', 'Update DNS blocklist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dns_blocklists.update');

INSERT INTO permissions (name, description, module)
SELECT 'dns_blocklists.delete', 'Remove DNS blocklist entries', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dns_blocklists.delete');

-- ---------------------------------------------------------------------------
-- Module: security — cpe_security_scans
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'cpe_security_scans.view', 'View CPE security scan results', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cpe_security_scans.view');

INSERT INTO permissions (name, description, module)
SELECT 'cpe_security_scans.create', 'Initiate CPE security scans', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cpe_security_scans.create');

-- ---------------------------------------------------------------------------
-- Module: security — encryption_keys
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'encryption_keys.view', 'View encryption key metadata and rotation status', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'encryption_keys.view');

INSERT INTO permissions (name, description, module)
SELECT 'encryption_keys.update', 'Trigger encryption key rotation and update key metadata', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'encryption_keys.update');

-- ---------------------------------------------------------------------------
-- Module: security — data_masking
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'data_masking.view', 'View data masking rules configuration', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_masking.view');

INSERT INTO permissions (name, description, module)
SELECT 'data_masking.update', 'Create and update data masking rules', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_masking.update');

-- ---------------------------------------------------------------------------
-- Module: security — secure_deletion
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'secure_deletion.view', 'View secure deletion audit log', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'secure_deletion.view');

INSERT INTO permissions (name, description, module)
SELECT 'secure_deletion.run', 'Execute secure deletion operations', 'security'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'secure_deletion.run');

-- ---------------------------------------------------------------------------
-- Role assignments
-- ---------------------------------------------------------------------------

-- super_admin: all §17 security permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
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
)
WHERE r.name = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- admin: all §17 security permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
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
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- noc_operator: network security operations (firewall, ddos, blackhole, dns, cpe scans)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'webauthn.view',
  'firewall_rules.view','firewall_rules.create','firewall_rules.update','firewall_rules.delete',
  'ddos_protection.view','ddos_protection.create','ddos_protection.update','ddos_protection.delete',
  'blackhole_routes.view','blackhole_routes.create','blackhole_routes.update','blackhole_routes.delete',
  'dns_blocklists.view','dns_blocklists.create','dns_blocklists.update',
  'cpe_security_scans.view','cpe_security_scans.create',
  'encryption_keys.view'
)
WHERE r.name = 'noc_operator'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- reseller_admin: limited security visibility for their org
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'webauthn.view','webauthn.create','webauthn.delete',
  'admin_ip_allowlist.view','admin_ip_allowlist.create',
  'password_policy.view',
  'api_key_rate_limits.view',
  'firewall_rules.view',
  'ddos_protection.view',
  'blackhole_routes.view',
  'dns_blocklists.view',
  'cpe_security_scans.view'
)
WHERE r.name = 'reseller_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- auditor: read-only view of all security resources
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'webauthn.view',
  'admin_ip_allowlist.view',
  'password_policy.view',
  'api_key_rate_limits.view',
  'firewall_rules.view',
  'ddos_protection.view',
  'blackhole_routes.view',
  'dns_blocklists.view',
  'cpe_security_scans.view',
  'encryption_keys.view',
  'data_masking.view',
  'secure_deletion.view'
)
WHERE r.name = 'auditor'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: CPE scan read + device security view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cpe_security_scans.view','cpe_security_scans.create',
  'firewall_rules.view',
  'ddos_protection.view',
  'blackhole_routes.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: no security permissions (principle of least privilege — security data is sensitive)
-- (intentionally empty for readonly role)
