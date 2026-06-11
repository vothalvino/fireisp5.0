-- =============================================================================
-- Migration 253: RBAC Permissions for §6.1-6.3 (SNMP Discovery, Monitoring)
-- =============================================================================
-- Implements isp-platform-features.md §6.1-6.3:
--   Seeds 12 permissions covering device group management, discovery scan
--   management, and SNMP trap forwarding rule management.
--
-- Permissions seeded (12 total):
--   device_groups.*    — CRUD for device group definitions
--   discovery_scans.*  — CRUD for network discovery scans
--   trap_forwarding.*  — CRUD for SNMP trap forwarding rules
--
-- Role matrix:
--   admin       — all 12 permissions
--   technician  — device_groups.view, discovery_scans.view/create/update,
--                 trap_forwarding.view (5 permissions)
--   readonly    — device_groups.view, discovery_scans.view,
--                 trap_forwarding.view (3 permissions)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('device_groups.view',      'View device groups',                           'monitoring'),
  ('device_groups.create',    'Create device groups',                         'monitoring'),
  ('device_groups.update',    'Update device groups',                         'monitoring'),
  ('device_groups.delete',    'Delete device groups',                         'monitoring'),
  ('discovery_scans.view',    'View network discovery scans',                 'monitoring'),
  ('discovery_scans.create',  'Create and initiate network discovery scans',  'monitoring'),
  ('discovery_scans.update',  'Update network discovery scans',               'monitoring'),
  ('discovery_scans.delete',  'Delete network discovery scans',               'monitoring'),
  ('trap_forwarding.view',    'View SNMP trap forwarding rules',              'monitoring'),
  ('trap_forwarding.create',  'Create SNMP trap forwarding rules',            'monitoring'),
  ('trap_forwarding.update',  'Update SNMP trap forwarding rules',            'monitoring'),
  ('trap_forwarding.delete',  'Delete SNMP trap forwarding rules',            'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 12 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'device_groups.view',
           'device_groups.create',
           'device_groups.update',
           'device_groups.delete',
           'discovery_scans.view',
           'discovery_scans.create',
           'discovery_scans.update',
           'discovery_scans.delete',
           'trap_forwarding.view',
           'trap_forwarding.create',
           'trap_forwarding.update',
           'trap_forwarding.delete'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: device_groups.view, discovery_scans.view/create/update,
--             trap_forwarding.view
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'device_groups.view',
           'discovery_scans.view',
           'discovery_scans.create',
           'discovery_scans.update',
           'trap_forwarding.view'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: device_groups.view, discovery_scans.view, trap_forwarding.view
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'device_groups.view',
           'discovery_scans.view',
           'trap_forwarding.view'
       )
WHERE  r.name = 'readonly';
