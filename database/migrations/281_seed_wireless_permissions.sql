-- =============================================================================
-- Migration 281: Seed RBAC Permissions for §9.1 Wireless/WISP Management
-- =============================================================================
-- Seeds 15 permissions for the wireless module:
--   ap_sectors.*              (4): view, create, update, delete
--   ap_channel_plans.*        (4): view, create, update, delete
--   wireless_clients.view     (1)
--   wireless_channels.*       (2): view, manage
--   ap_commands.*             (2): view, create
--   wireless_speed_profiles.* (2): view, manage
--
-- Role matrix:
--   admin       — all 15 permissions
--   technician  — all view + create/update on ap_sectors, channel_plans, ap_commands
--   readonly    — view permissions only (5)
--
-- All INSERTs use INSERT IGNORE — idempotent/safe to re-run.
-- Role assignment uses INSERT IGNORE on (role_id, permission_id).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('ap_sectors.view',                    'View AP sector configurations',                           'wireless'),
    ('ap_sectors.create',                  'Create AP sector configurations',                         'wireless'),
    ('ap_sectors.update',                  'Update AP sector configurations',                         'wireless'),
    ('ap_sectors.delete',                  'Delete AP sector configurations',                         'wireless'),
    ('ap_channel_plans.view',              'View AP channel plans',                                   'wireless'),
    ('ap_channel_plans.create',            'Create AP channel plans',                                 'wireless'),
    ('ap_channel_plans.update',            'Update AP channel plans',                                 'wireless'),
    ('ap_channel_plans.delete',            'Delete AP channel plans',                                 'wireless'),
    ('wireless_clients.view',              'View wireless client session snapshots',                  'wireless'),
    ('wireless_channels.view',             'View wireless channel interference records',              'wireless'),
    ('wireless_channels.manage',           'Manage wireless channel interference records',            'wireless'),
    ('ap_commands.view',                   'View AP remote command jobs',                             'wireless'),
    ('ap_commands.create',                 'Create AP remote command jobs',                           'wireless'),
    ('wireless_speed_profiles.view',       'View wireless AP-level speed profiles',                   'wireless'),
    ('wireless_speed_profiles.manage',     'Manage wireless AP-level speed profiles',                 'wireless');

-- ---------------------------------------------------------------------------
-- Part 2: Assign to admin role (all 15)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ap_sectors.view', 'ap_sectors.create', 'ap_sectors.update', 'ap_sectors.delete',
    'ap_channel_plans.view', 'ap_channel_plans.create', 'ap_channel_plans.update', 'ap_channel_plans.delete',
    'wireless_clients.view',
    'wireless_channels.view', 'wireless_channels.manage',
    'ap_commands.view', 'ap_commands.create',
    'wireless_speed_profiles.view', 'wireless_speed_profiles.manage'
)
WHERE r.name = 'admin';

-- ---------------------------------------------------------------------------
-- Part 3: Assign to technician role
-- (all view + create/update on ap_sectors, channel_plans, ap_commands)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ap_sectors.view', 'ap_sectors.create', 'ap_sectors.update',
    'ap_channel_plans.view', 'ap_channel_plans.create', 'ap_channel_plans.update',
    'wireless_clients.view',
    'wireless_channels.view',
    'ap_commands.view', 'ap_commands.create',
    'wireless_speed_profiles.view'
)
WHERE r.name = 'technician';

-- ---------------------------------------------------------------------------
-- Part 4: Assign to readonly role (view permissions only)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ap_sectors.view',
    'ap_channel_plans.view',
    'wireless_clients.view',
    'wireless_channels.view',
    'wireless_speed_profiles.view'
)
WHERE r.name = 'readonly';
