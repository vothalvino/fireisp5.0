-- Migration 212: Seed RBAC permissions for payment plans

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('payment_plans.view',   'View payment plans and installment schedules',  'billing'),
    ('payment_plans.create', 'Create new payment plans for clients',           'billing'),
    ('payment_plans.update', 'Update payment plan details and installments',   'billing'),
    ('payment_plans.delete', 'Cancel or delete payment plans',                 'billing');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'payment_plans.view',
           'payment_plans.create',
           'payment_plans.update',
           'payment_plans.delete'
       )
WHERE  r.name = 'admin';

-- billing: view + create + update (no delete)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'payment_plans.view',
           'payment_plans.create',
           'payment_plans.update'
       )
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_plans.view')
WHERE  r.name = 'support';

-- technician: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_plans.view')
WHERE  r.name = 'technician';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_plans.view')
WHERE  r.name = 'readonly';
