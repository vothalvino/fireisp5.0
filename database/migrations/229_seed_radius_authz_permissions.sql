-- =============================================================================
-- Migration 229: RBAC permissions for RADIUS authorization gap features (§3.2)
-- =============================================================================
-- Seeds permissions for:
--   • plan_access_windows CRUD  (nested under plans)
--   • radius VLAN + sim-use editing (reuses devices.* permissions)
--   • radius_account_routes CRUD
--   • walled_garden settings read/write
--   • radius.kick_sessions (admin-only manual kick trigger)
--
-- Role matrix:
--   admin      — all new permissions
--   technician — radius_account_routes.view, walled_garden.view
--   support    — walled_garden.view
--   billing    — none
--   readonly   — radius_account_routes.view, walled_garden.view
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('plan_access_windows.view',         'View plan time-based access schedules',                  'plans'),
    ('plan_access_windows.create',       'Create plan time-based access schedule windows',         'plans'),
    ('plan_access_windows.update',       'Update plan time-based access schedule windows',         'plans'),
    ('plan_access_windows.delete',       'Delete plan time-based access schedule windows',         'plans'),
    ('radius_account_routes.view',       'View per-account injected routes (Framed-Route)',        'radius'),
    ('radius_account_routes.create',     'Add per-account injected routes',                        'radius'),
    ('radius_account_routes.update',     'Update per-account injected routes',                     'radius'),
    ('radius_account_routes.delete',     'Delete per-account injected routes',                     'radius'),
    ('walled_garden.view',               'View org walled garden settings',                        'radius'),
    ('walled_garden.update',             'Update org walled garden settings',                      'radius'),
    ('radius.kick_sessions',             'Manually trigger duplicate-session kick for an org',     'radius');

-- admin: all new permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'plan_access_windows.view',
           'plan_access_windows.create',
           'plan_access_windows.update',
           'plan_access_windows.delete',
           'radius_account_routes.view',
           'radius_account_routes.create',
           'radius_account_routes.update',
           'radius_account_routes.delete',
           'walled_garden.view',
           'walled_garden.update',
           'radius.kick_sessions'
       )
WHERE  r.name = 'admin';

-- technician: routes view + walled garden view
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius_account_routes.view',
           'walled_garden.view'
       )
WHERE  r.name = 'technician';

-- support: walled garden view
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'walled_garden.view'
       )
WHERE  r.name = 'support';

-- readonly: routes view + walled garden view
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius_account_routes.view',
           'walled_garden.view'
       )
WHERE  r.name = 'readonly';
