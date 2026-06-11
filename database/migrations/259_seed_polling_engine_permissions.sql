-- =============================================================================
-- Migration 259: RBAC Permissions for §6.4 Polling Engine
-- =============================================================================
-- Implements isp-platform-features.md §6.4 "Polling Engine":
--   Seeds 9 permissions covering poller node management, polling config
--   management, and poller performance viewing.
--
-- Permissions seeded (9 total):
--   poller_nodes.view      — View poller node registry
--   poller_nodes.create    — Register new poller nodes
--   poller_nodes.update    — Update poller node configuration
--   poller_nodes.delete    — Remove poller nodes
--   polling_configs.view   — View device polling configurations
--   polling_configs.create — Create device polling config overrides
--   polling_configs.update — Update device polling configurations
--   polling_configs.delete — Delete device polling configurations
--   poller_performance.view — View poller performance dashboards and snapshots
--
-- Role matrix:
--   admin       — all 9 permissions
--   technician  — poller_nodes.view, polling_configs.view/create/update, poller_performance.view (5)
--   readonly    — poller_nodes.view, polling_configs.view, poller_performance.view (3)
--
-- Uses INSERT IGNORE — safe to re-run.
--
-- Requires:
--   049_create_roles_permissions_tables
--   258_polling_engine_tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('poller_nodes.view',       'View poller node registry',                     'monitoring'),
  ('poller_nodes.create',     'Register new poller nodes',                     'monitoring'),
  ('poller_nodes.update',     'Update poller node configuration',              'monitoring'),
  ('poller_nodes.delete',     'Remove poller nodes',                           'monitoring'),
  ('polling_configs.view',    'View device polling configurations',            'monitoring'),
  ('polling_configs.create',  'Create device polling config overrides',        'monitoring'),
  ('polling_configs.update',  'Update device polling configurations',          'monitoring'),
  ('polling_configs.delete',  'Delete device polling configurations',          'monitoring'),
  ('poller_performance.view', 'View poller performance dashboards and snapshots', 'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 9 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'poller_nodes.view',
           'poller_nodes.create',
           'poller_nodes.update',
           'poller_nodes.delete',
           'polling_configs.view',
           'polling_configs.create',
           'polling_configs.update',
           'polling_configs.delete',
           'poller_performance.view'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: poller_nodes.view, polling_configs.view/create/update, poller_performance.view
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'poller_nodes.view',
           'polling_configs.view',
           'polling_configs.create',
           'polling_configs.update',
           'poller_performance.view'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: poller_nodes.view, polling_configs.view, poller_performance.view
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'poller_nodes.view',
           'polling_configs.view',
           'poller_performance.view'
       )
WHERE  r.name = 'readonly';

-- END OF MIGRATION 259
