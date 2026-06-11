-- =============================================================================
-- Migration 263: RBAC Permissions for §6.6 (Config Management)
-- =============================================================================
-- Seeds 16 permissions covering config template management, deployment records,
-- backup schedules, and compliance rules/audit.
--
-- Permissions seeded (16 total):
--   config_templates.*         — CRUD for config templates
--   config_deployments.*       — view/create/update for deployment records
--   config_backup_schedules.*  — CRUD for backup schedules
--   config_compliance.*        — CRUD + run for compliance rules
--
-- Role matrix:
--   admin       — all 16 permissions
--   technician  — all *.view (4) + config_templates.create/update +
--                 config_backup_schedules.create/update + config_compliance.run = 10
--   readonly    — config_templates.view, config_deployments.view,
--                 config_backup_schedules.view, config_compliance.view = 4
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('config_templates.view',           'View config templates',                  'config_management'),
  ('config_templates.create',         'Create config templates',                'config_management'),
  ('config_templates.update',         'Update config templates',                'config_management'),
  ('config_templates.delete',         'Delete config templates',                'config_management'),
  ('config_deployments.view',         'View config deployment records',         'config_management'),
  ('config_deployments.create',       'Deploy a config template to a device',   'config_management'),
  ('config_deployments.update',       'Update config deployment records',       'config_management'),
  ('config_backup_schedules.view',    'View config backup schedules',           'config_management'),
  ('config_backup_schedules.create',  'Create config backup schedules',         'config_management'),
  ('config_backup_schedules.update',  'Update config backup schedules',         'config_management'),
  ('config_backup_schedules.delete',  'Delete config backup schedules',         'config_management'),
  ('config_compliance.view',          'View config compliance rules and results','config_management'),
  ('config_compliance.create',        'Create config compliance rules',         'config_management'),
  ('config_compliance.update',        'Update config compliance rules',         'config_management'),
  ('config_compliance.delete',        'Delete config compliance rules',         'config_management'),
  ('config_compliance.run',           'Run compliance audit on a backup',       'config_management');

-- ---------------------------------------------------------------------------
-- admin: all 16 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'config_templates.view',
           'config_templates.create',
           'config_templates.update',
           'config_templates.delete',
           'config_deployments.view',
           'config_deployments.create',
           'config_deployments.update',
           'config_backup_schedules.view',
           'config_backup_schedules.create',
           'config_backup_schedules.update',
           'config_backup_schedules.delete',
           'config_compliance.view',
           'config_compliance.create',
           'config_compliance.update',
           'config_compliance.delete',
           'config_compliance.run'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: views + create/update templates + create/update schedules + run
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'config_templates.view',
           'config_templates.create',
           'config_templates.update',
           'config_deployments.view',
           'config_backup_schedules.view',
           'config_backup_schedules.create',
           'config_backup_schedules.update',
           'config_compliance.view',
           'config_compliance.run'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: view permissions only (4)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'config_templates.view',
           'config_deployments.view',
           'config_backup_schedules.view',
           'config_compliance.view'
       )
WHERE  r.name = 'readonly';
