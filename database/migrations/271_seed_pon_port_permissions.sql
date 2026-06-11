-- =============================================================================
-- Migration 271: RBAC Permissions for §7.3 PON Port Management
-- =============================================================================
-- New permissions:
--   olt_ports.shutdown       — set/clear maintenance mode on a PON port
--   olt_ports.configure_mode — update XGS-PON mode on a port
--   onu_migration_jobs.*     — CRUD for ONU port migration jobs
--   olt_ports.utilization    — view PON port utilization dashboard
--   olt_ports.power_budget   — use optical power budget calculator
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
  -- PON port operational actions
  ('olt_ports.shutdown',        'Set or clear maintenance mode on a PON port',          'monitoring'),
  ('olt_ports.configure_mode',  'Configure XGS-PON sub-mode on a dual-mode PON port',  'monitoring'),
  ('olt_ports.utilization',     'View PON port utilization dashboard and ONU lists',    'monitoring'),
  ('olt_ports.power_budget',    'Use optical power budget calculator',                  'monitoring'),
  -- ONU migration jobs
  ('onu_migration_jobs.view',   'View ONU port migration jobs',                        'monitoring'),
  ('onu_migration_jobs.create', 'Create ONU port migration jobs',                      'monitoring'),
  ('onu_migration_jobs.update', 'Update ONU migration job records (cancel)',            'monitoring'),
  ('onu_migration_jobs.delete', 'Delete ONU migration job records',                    'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all new permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_ports.shutdown',
           'olt_ports.configure_mode',
           'olt_ports.utilization',
           'olt_ports.power_budget',
           'onu_migration_jobs.view',
           'onu_migration_jobs.create',
           'onu_migration_jobs.update',
           'onu_migration_jobs.delete'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: view + utilization + power_budget + create migrations + shutdown
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_ports.utilization',
           'olt_ports.power_budget',
           'olt_ports.shutdown',
           'olt_ports.configure_mode',
           'onu_migration_jobs.view',
           'onu_migration_jobs.create'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: view utilization + power budget only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'olt_ports.utilization',
           'olt_ports.power_budget',
           'onu_migration_jobs.view'
       )
WHERE  r.name = 'readonly';
