-- =============================================================================
-- Migration 283: Seed RBAC Permissions for §9.2 PTP/PTMP Links + Link Planning
-- =============================================================================
-- Seeds 8 permissions for the wireless module:
--   ptp_links.*      (2): view, update
--   link_planning.*  (4): view, create, update, delete
--   link_failover.*  (2): view, manage
--
-- Role matrix:
--   admin       — all 8 permissions
--   technician  — ptp_links.view/update, link_planning.view/create/update,
--                 link_failover.view/manage
--   readonly    — ptp_links.view, link_planning.view, link_failover.view
--
-- All INSERTs use INSERT IGNORE — idempotent/safe to re-run.
-- Role assignment uses INSERT IGNORE on (role_id, permission_id).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('ptp_links.view',         'View PTP/PTMP link monitoring data',              'wireless'),
    ('ptp_links.update',       'Update PTP/PTMP link monitoring data',            'wireless'),
    ('link_planning.view',     'View link planning calculator runs',              'wireless'),
    ('link_planning.create',   'Create link planning calculator runs',            'wireless'),
    ('link_planning.update',   'Update link planning calculator runs',            'wireless'),
    ('link_planning.delete',   'Delete link planning calculator runs',            'wireless'),
    ('link_failover.view',     'View link failover status and configuration',     'wireless'),
    ('link_failover.manage',   'Manage link failover configuration and state',    'wireless');

-- ---------------------------------------------------------------------------
-- Part 2: Assign to admin role (all 8)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ptp_links.view', 'ptp_links.update',
    'link_planning.view', 'link_planning.create', 'link_planning.update', 'link_planning.delete',
    'link_failover.view', 'link_failover.manage'
)
WHERE r.name = 'admin';

-- ---------------------------------------------------------------------------
-- Part 3: Assign to technician role
-- (ptp_links.view/update + link_planning.view/create/update + link_failover.view/manage)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ptp_links.view', 'ptp_links.update',
    'link_planning.view', 'link_planning.create', 'link_planning.update',
    'link_failover.view', 'link_failover.manage'
)
WHERE r.name = 'technician';

-- ---------------------------------------------------------------------------
-- Part 4: Assign to readonly role (view permissions only)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'ptp_links.view',
    'link_planning.view',
    'link_failover.view'
)
WHERE r.name = 'readonly';
