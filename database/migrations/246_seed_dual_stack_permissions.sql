-- =============================================================================
-- Migration 246: RBAC Permissions for Dual Stack (IPv4 + IPv6)
-- =============================================================================
-- Implements isp-platform-features.md §5 "Dual Stack (IPv4 + IPv6)":
--   Seeds 25 permissions covering DHCP servers, DHCP reservations, NAT pools,
--   PTR records, RA Guard policies, IPv6 transition mechanisms, and general
--   IPv6 management.
--
-- Permissions seeded (25 total):
--   dhcp_servers.*          — CRUD for DHCP server registry
--   dhcp_reservations.*     — CRUD for static IP/MAC reservations
--   nat_pools.*             — CRUD for NAT/CGNAT pool definitions
--   ptr_records.*           — CRUD for reverse DNS PTR records
--   ra_guard.*              — CRUD for RA Guard policies
--   transition_mechanisms.* — CRUD for 6rd/DS-Lite/MAP/464XLAT configs
--   ipv6.management         — General IPv6 dual-stack management
--
-- Role matrix:
--   admin       — all 25 permissions
--   technician  — all *.view permissions + ipv6.management (7 permissions)
--   readonly    — *.view permissions only (6 permissions)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('dhcp_servers.view',              'View DHCP servers',                                          'network'),
  ('dhcp_servers.create',            'Create DHCP servers',                                        'network'),
  ('dhcp_servers.update',            'Update DHCP servers',                                        'network'),
  ('dhcp_servers.delete',            'Delete DHCP servers',                                        'network'),
  ('dhcp_reservations.view',         'View DHCP static reservations',                              'network'),
  ('dhcp_reservations.create',       'Create DHCP static reservations',                            'network'),
  ('dhcp_reservations.update',       'Update DHCP static reservations',                            'network'),
  ('dhcp_reservations.delete',       'Delete DHCP static reservations',                            'network'),
  ('nat_pools.view',                 'View NAT/CGNAT pools',                                       'network'),
  ('nat_pools.create',               'Create NAT/CGNAT pools',                                     'network'),
  ('nat_pools.update',               'Update NAT/CGNAT pools',                                     'network'),
  ('nat_pools.delete',               'Delete NAT/CGNAT pools',                                     'network'),
  ('ptr_records.view',               'View PTR (reverse DNS) records',                             'network'),
  ('ptr_records.create',             'Create PTR (reverse DNS) records',                           'network'),
  ('ptr_records.update',             'Update PTR (reverse DNS) records',                           'network'),
  ('ptr_records.delete',             'Delete PTR (reverse DNS) records',                           'network'),
  ('ra_guard.view',                  'View RA Guard policies',                                     'network'),
  ('ra_guard.create',                'Create RA Guard policies',                                   'network'),
  ('ra_guard.update',                'Update RA Guard policies',                                   'network'),
  ('ra_guard.delete',                'Delete RA Guard policies',                                   'network'),
  ('transition_mechanisms.view',     'View IPv6 transition mechanism configurations',               'network'),
  ('transition_mechanisms.create',   'Create IPv6 transition mechanism configurations',             'network'),
  ('transition_mechanisms.update',   'Update IPv6 transition mechanism configurations',             'network'),
  ('transition_mechanisms.delete',   'Delete IPv6 transition mechanism configurations',             'network'),
  ('ipv6.management',                'General IPv6 dual-stack management and diagnostics',          'network');

-- ---------------------------------------------------------------------------
-- admin: all 25 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'dhcp_servers.view',
           'dhcp_servers.create',
           'dhcp_servers.update',
           'dhcp_servers.delete',
           'dhcp_reservations.view',
           'dhcp_reservations.create',
           'dhcp_reservations.update',
           'dhcp_reservations.delete',
           'nat_pools.view',
           'nat_pools.create',
           'nat_pools.update',
           'nat_pools.delete',
           'ptr_records.view',
           'ptr_records.create',
           'ptr_records.update',
           'ptr_records.delete',
           'ra_guard.view',
           'ra_guard.create',
           'ra_guard.update',
           'ra_guard.delete',
           'transition_mechanisms.view',
           'transition_mechanisms.create',
           'transition_mechanisms.update',
           'transition_mechanisms.delete',
           'ipv6.management'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: all *.view permissions + ipv6.management (7 permissions)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'dhcp_servers.view',
           'dhcp_reservations.view',
           'nat_pools.view',
           'ptr_records.view',
           'ra_guard.view',
           'transition_mechanisms.view',
           'ipv6.management'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: *.view permissions only (6 permissions)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'dhcp_servers.view',
           'dhcp_reservations.view',
           'nat_pools.view',
           'ptr_records.view',
           'ra_guard.view',
           'transition_mechanisms.view'
       )
WHERE  r.name = 'readonly';
