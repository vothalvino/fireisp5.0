-- Migration: 194_seed_lifecycle_permissions
-- Description: Seeds the RBAC permissions for the Customer Lifecycle module
--              (isp-platform-features.md §1.2) and assigns them to the default
--              system roles.
--
--              Permission slugs (module = 'lifecycle'):
--                leads.view/create/update/delete
--                service_orders.view/create/update/delete
--                winback.view/create/update/delete
--                lifecycle.view            — churn / pipeline analytics
--
--              Uses INSERT IGNORE throughout so re-running on an existing
--              installation is safe.

-- -------------------------------------------------------------------------
-- 1. New permissions
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('leads.view',             'View leads and the prospect pipeline',        'lifecycle'),
    ('leads.create',           'Create leads',                                'lifecycle'),
    ('leads.update',           'Edit leads and move pipeline stage',          'lifecycle'),
    ('leads.delete',           'Delete leads',                                'lifecycle'),
    ('service_orders.view',    'View service orders',                         'lifecycle'),
    ('service_orders.create',  'Create service orders',                       'lifecycle'),
    ('service_orders.update',  'Advance, edit, and cancel service orders',    'lifecycle'),
    ('service_orders.delete',  'Delete service orders',                       'lifecycle'),
    ('winback.view',           'View win-back campaigns',                     'lifecycle'),
    ('winback.create',         'Create win-back campaigns',                   'lifecycle'),
    ('winback.update',         'Edit win-back campaigns',                     'lifecycle'),
    ('winback.delete',         'Delete win-back campaigns',                   'lifecycle'),
    ('lifecycle.view',         'View churn analytics and pipeline reports',   'lifecycle');

-- -------------------------------------------------------------------------
-- 2. Assign permissions to roles
-- -------------------------------------------------------------------------

-- admin: every lifecycle permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.module = 'lifecycle'
WHERE  r.name = 'admin';

-- support: manage leads + service orders, view analytics
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'leads.view','leads.create','leads.update',
           'service_orders.view','service_orders.create','service_orders.update',
           'lifecycle.view'
       )
WHERE  r.name = 'support';

-- billing: view leads/orders, manage win-back campaigns, view analytics
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'leads.view','service_orders.view',
           'winback.view','winback.create','winback.update','winback.delete',
           'lifecycle.view'
       )
WHERE  r.name = 'billing';

-- technician: view + advance service orders (field installs)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('service_orders.view','service_orders.update')
WHERE  r.name = 'technician';

-- readonly: view-only across the module
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'leads.view','service_orders.view','winback.view','lifecycle.view'
       )
WHERE  r.name = 'readonly';
