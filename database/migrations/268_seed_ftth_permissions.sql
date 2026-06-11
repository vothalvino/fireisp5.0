-- =============================================================================
-- Migration 268: RBAC Permissions for FTTH OLT & ONU Management (§7.1/§7.2)
-- =============================================================================
-- Permissions seeded (28 total):
--   olt_management.*        — CRUD for OLT devices and port monitoring
--   olt_ports.*             — CRUD for OLT port records
--   olt_splitters.*         — CRUD for splitter inventory
--   onu_management.*        — CRUD for ONU devices
--   onu_profiles.*          — CRUD for PON service profile templates
--   onu_whitelist.*         — CRUD for ONU allow/block list
--   onu_omci_configs.*      — CRUD for OMCI/TR-069 config records
--   onu_firmware_jobs.*     — CRUD for firmware upgrade/reboot jobs
--
-- Role matrix:
--   admin       — all 28 permissions
--   technician  — all *.view permissions + onu_management.update
--                 + onu_firmware_jobs.create + onu_omci_configs.create (9 perms)
--   readonly    — *.view permissions only (7 perms)
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
  -- OLT management
  ('olt_management.view',         'View OLT devices and chassis metrics',         'monitoring'),
  ('olt_management.create',       'Create OLT device records',                    'monitoring'),
  ('olt_management.update',       'Update OLT device configuration',              'monitoring'),
  ('olt_management.delete',       'Delete OLT device records',                    'monitoring'),
  -- OLT ports
  ('olt_ports.view',              'View OLT port inventory and metrics',           'monitoring'),
  ('olt_ports.create',            'Create OLT port records',                      'monitoring'),
  ('olt_ports.update',            'Update OLT port records',                      'monitoring'),
  ('olt_ports.delete',            'Delete OLT port records',                      'monitoring'),
  -- Splitters
  ('olt_splitters.view',          'View splitter inventory',                      'monitoring'),
  ('olt_splitters.create',        'Create splitter records',                      'monitoring'),
  ('olt_splitters.update',        'Update splitter records',                      'monitoring'),
  ('olt_splitters.delete',        'Delete splitter records',                      'monitoring'),
  -- ONU management
  ('onu_management.view',         'View ONU devices and status',                  'monitoring'),
  ('onu_management.create',       'Provision new ONU devices',                    'monitoring'),
  ('onu_management.update',       'Update ONU configuration and profiles',        'monitoring'),
  ('onu_management.delete',       'Delete ONU device records',                    'monitoring'),
  -- ONU profiles
  ('onu_profiles.view',           'View PON service profile templates',           'monitoring'),
  ('onu_profiles.create',         'Create PON service profile templates',         'monitoring'),
  ('onu_profiles.update',         'Update PON service profile templates',         'monitoring'),
  ('onu_profiles.delete',         'Delete PON service profile templates',         'monitoring'),
  -- ONU whitelist
  ('onu_whitelist.view',          'View ONU MAC/SN allow-block list',             'monitoring'),
  ('onu_whitelist.create',        'Add entries to ONU allow-block list',          'monitoring'),
  ('onu_whitelist.update',        'Update ONU whitelist entries',                 'monitoring'),
  ('onu_whitelist.delete',        'Remove entries from ONU allow-block list',     'monitoring'),
  -- ONU OMCI / TR-069 configs
  ('onu_omci_configs.view',       'View OMCI/TR-069 config records per ONU',     'monitoring'),
  ('onu_omci_configs.create',     'Create OMCI/TR-069 config records',           'monitoring'),
  ('onu_omci_configs.update',     'Update OMCI/TR-069 config records',           'monitoring'),
  ('onu_omci_configs.delete',     'Delete OMCI/TR-069 config records',           'monitoring'),
  -- ONU firmware / reboot jobs
  ('onu_firmware_jobs.view',      'View ONU firmware upgrade and reboot jobs',    'monitoring'),
  ('onu_firmware_jobs.create',    'Schedule ONU firmware upgrades and reboots',  'monitoring'),
  ('onu_firmware_jobs.update',    'Update ONU job records (cancel/reschedule)',   'monitoring'),
  ('onu_firmware_jobs.delete',    'Delete ONU job records',                      'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 32 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_management.view',     'olt_management.create',
           'olt_management.update',   'olt_management.delete',
           'olt_ports.view',          'olt_ports.create',
           'olt_ports.update',        'olt_ports.delete',
           'olt_splitters.view',      'olt_splitters.create',
           'olt_splitters.update',    'olt_splitters.delete',
           'onu_management.view',     'onu_management.create',
           'onu_management.update',   'onu_management.delete',
           'onu_profiles.view',       'onu_profiles.create',
           'onu_profiles.update',     'onu_profiles.delete',
           'onu_whitelist.view',      'onu_whitelist.create',
           'onu_whitelist.update',    'onu_whitelist.delete',
           'onu_omci_configs.view',   'onu_omci_configs.create',
           'onu_omci_configs.update', 'onu_omci_configs.delete',
           'onu_firmware_jobs.view',  'onu_firmware_jobs.create',
           'onu_firmware_jobs.update','onu_firmware_jobs.delete'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: view all + update ONU + create jobs + create OMCI configs
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_management.view',
           'olt_ports.view',
           'olt_splitters.view',
           'onu_management.view',
           'onu_management.update',
           'onu_profiles.view',
           'onu_whitelist.view',
           'onu_whitelist.create',
           'onu_omci_configs.view',
           'onu_omci_configs.create',
           'onu_firmware_jobs.view',
           'onu_firmware_jobs.create'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: *.view permissions only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_management.view',
           'olt_ports.view',
           'olt_splitters.view',
           'onu_management.view',
           'onu_profiles.view',
           'onu_whitelist.view',
           'onu_omci_configs.view',
           'onu_firmware_jobs.view'
       )
WHERE  r.name = 'readonly';
