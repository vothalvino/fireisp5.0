-- Migration: 119_seed_default_roles_and_permissions
-- Description: Seeds the RBAC tables (roles, permissions, role_permissions)
--              with the default system roles and granular permission slugs
--              required for a functioning FireISP installation.
--
--              Without this seed data the application has no RBAC state on a
--              fresh install — every access-control check would fail or fall
--              back to a default-deny posture.
--
--              Roles seeded:
--                admin       — full access to everything
--                billing     — billing-module access
--                support     — ticket and client access
--                technician  — device and job access
--                readonly    — read-only view of all modules
--
--              All roles are flagged is_system = TRUE so they cannot be
--              deleted through the UI.  Uses INSERT IGNORE throughout so
--              re-running this migration on an existing installation is safe.

-- -------------------------------------------------------------------------
-- 1. Roles
-- -------------------------------------------------------------------------
INSERT IGNORE INTO roles (name, description, is_system) VALUES
    ('admin',      'Full system access — can manage all resources and settings', TRUE),
    ('billing',    'Billing module access — invoices, payments, plans, and subscriptions', TRUE),
    ('support',    'Support access — clients, tickets, and related communications', TRUE),
    ('technician', 'Field / NOC technician — devices, jobs, network, and inventory', TRUE),
    ('readonly',   'Read-only observer — can view all resources but cannot modify anything', TRUE);

-- -------------------------------------------------------------------------
-- 2. Permissions  (slug format: module.action)
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    -- clients
    ('clients.view',            'View client list and profiles',          'clients'),
    ('clients.create',          'Create new clients',                     'clients'),
    ('clients.update',          'Edit existing client records',           'clients'),
    ('clients.delete',          'Delete or deactivate clients',          'clients'),
    -- contracts
    ('contracts.view',          'View service contracts',                 'contracts'),
    ('contracts.create',        'Create new service contracts',           'contracts'),
    ('contracts.update',        'Modify existing contracts',              'contracts'),
    ('contracts.delete',        'Cancel or delete contracts',             'contracts'),
    -- invoices
    ('invoices.view',           'View invoices',                          'billing'),
    ('invoices.create',         'Generate new invoices',                  'billing'),
    ('invoices.update',         'Edit draft invoices',                    'billing'),
    ('invoices.delete',         'Void or delete invoices',                'billing'),
    -- payments
    ('payments.view',           'View payment records',                   'billing'),
    ('payments.create',         'Record new payments',                    'billing'),
    ('payments.update',         'Edit payment records',                   'billing'),
    ('payments.delete',         'Delete payment records',                 'billing'),
    -- tickets
    ('tickets.view',            'View support tickets',                   'support'),
    ('tickets.create',          'Open new support tickets',               'support'),
    ('tickets.update',          'Update and respond to tickets',          'support'),
    ('tickets.delete',          'Delete tickets',                         'support'),
    -- devices
    ('devices.view',            'View network devices',                   'network'),
    ('devices.create',          'Add new devices',                        'network'),
    ('devices.update',          'Edit device configuration',              'network'),
    ('devices.delete',          'Remove devices',                         'network'),
    -- plans
    ('plans.view',              'View service plans',                     'billing'),
    ('plans.create',            'Create new service plans',               'billing'),
    ('plans.update',            'Edit existing plans',                    'billing'),
    ('plans.delete',            'Delete plans',                           'billing'),
    -- jobs
    ('jobs.view',               'View work orders',                       'jobs'),
    ('jobs.create',             'Create new work orders',                 'jobs'),
    ('jobs.update',             'Update work orders',                     'jobs'),
    ('jobs.delete',             'Delete work orders',                     'jobs'),
    -- expenses
    ('expenses.view',           'View expense records',                   'expenses'),
    ('expenses.create',         'Submit new expenses',                    'expenses'),
    ('expenses.update',         'Edit expense records',                   'expenses'),
    ('expenses.approve',        'Approve or reject submitted expenses',   'expenses'),
    -- reports
    ('reports.view',            'Access reports and dashboards',          'reports'),
    ('reports.export',          'Export report data',                     'reports'),
    -- settings
    ('settings.view',           'View application settings',              'settings'),
    ('settings.update',         'Modify application settings',            'settings'),
    -- users
    ('users.view',              'View user accounts',                     'users'),
    ('users.create',            'Create new user accounts',               'users'),
    ('users.update',            'Edit user accounts',                     'users'),
    ('users.delete',            'Delete or deactivate user accounts',     'users'),
    -- inventory
    ('inventory.view',          'View inventory items and stock',         'inventory'),
    ('inventory.create',        'Add inventory items',                    'inventory'),
    ('inventory.update',        'Edit inventory items',                   'inventory'),
    ('inventory.transfer',      'Transfer stock between warehouses',      'inventory'),
    -- network
    ('network.view',            'View network topology and resources',    'network'),
    ('network.create',          'Add network resources (NAS, IP pools)',  'network'),
    ('network.update',          'Edit network resources',                 'network'),
    ('network.delete',          'Remove network resources',               'network'),
    -- audit_logs
    ('audit_logs.view',         'View the audit log',                     'audit'),
    -- organizations
    ('organizations.view',      'View organization profile',              'organizations'),
    ('organizations.update',    'Edit organization settings',             'organizations');

-- -------------------------------------------------------------------------
-- 3. role_permissions — map each role to its allowed permissions
-- -------------------------------------------------------------------------

-- admin gets every permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON TRUE
WHERE  r.name = 'admin';

-- billing: invoices, payments, plans, clients (view), contracts (view),
--          reports, and settings (view)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
    'invoices.view',   'invoices.create',   'invoices.update',   'invoices.delete',
    'payments.view',   'payments.create',   'payments.update',   'payments.delete',
    'plans.view',      'plans.create',      'plans.update',      'plans.delete',
    'clients.view',
    'contracts.view',
    'reports.view',    'reports.export',
    'settings.view',
    'expenses.view',   'expenses.approve'
)
WHERE r.name = 'billing';

-- support: clients, contracts (view/update), tickets, reports (view)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
    'clients.view',    'clients.create',    'clients.update',
    'contracts.view',
    'tickets.view',    'tickets.create',    'tickets.update',    'tickets.delete',
    'reports.view'
)
WHERE r.name = 'support';

-- technician: devices, jobs, network, inventory, clients (view),
--             contracts (view)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
    'devices.view',    'devices.create',    'devices.update',    'devices.delete',
    'jobs.view',       'jobs.create',       'jobs.update',       'jobs.delete',
    'network.view',    'network.create',    'network.update',    'network.delete',
    'inventory.view',  'inventory.create',  'inventory.update',  'inventory.transfer',
    'clients.view',
    'contracts.view',
    'expenses.view',   'expenses.create'
)
WHERE r.name = 'technician';

-- readonly gets every *.view and *.export permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON (p.name LIKE '%.view' OR p.name LIKE '%.export')
WHERE  r.name = 'readonly';
