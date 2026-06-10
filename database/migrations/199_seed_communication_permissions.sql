-- Migration: 199_seed_communication_permissions
-- Description: Seeds the RBAC permissions for the Communication module
--              (isp-platform-features.md §1.4) and assigns them to the default
--              system roles.
--
--              Permission slugs (module = 'communication'):
--                campaigns.view/create/update/delete
--                dnd.view/dnd.update
--
--              Uses INSERT IGNORE throughout so re-running on an existing
--              installation is safe.

-- -------------------------------------------------------------------------
-- 1. New permissions
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('campaigns.view',   'View communication campaigns and per-recipient delivery stats', 'communication'),
    ('campaigns.create', 'Create bulk email/SMS/WhatsApp campaigns',                      'communication'),
    ('campaigns.update', 'Edit and schedule communication campaigns',                     'communication'),
    ('campaigns.delete', 'Delete communication campaigns',                                'communication'),
    ('dnd.view',         'View client Do Not Disturb preferences',                        'communication'),
    ('dnd.update',       'Set and update client Do Not Disturb preferences',              'communication');

-- -------------------------------------------------------------------------
-- 2. Assign permissions to roles
-- -------------------------------------------------------------------------

-- admin: every communication permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.module = 'communication'
WHERE  r.name = 'admin';

-- support: campaign management and DND management (no hard deletes)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view','campaigns.create','campaigns.update',
           'dnd.view','dnd.update'
       )
WHERE  r.name = 'support';

-- billing: full campaign management plus DND (billing team sends payment notices)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view','campaigns.create','campaigns.update','campaigns.delete',
           'dnd.view','dnd.update'
       )
WHERE  r.name = 'billing';

-- technician: view campaigns and DND preferences (read-only for field staff)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view',
           'dnd.view'
       )
WHERE  r.name = 'technician';

-- readonly: view-only across the module
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view',
           'dnd.view'
       )
WHERE  r.name = 'readonly';
