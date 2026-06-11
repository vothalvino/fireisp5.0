-- Migration 222: Seed RBAC permissions for chargebacks and billing adjustments

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('chargebacks.view',           'View chargebacks',                          'billing'),
    ('chargebacks.create',         'Create chargeback records manually',        'billing'),
    ('chargebacks.update',         'Update chargeback status and outcome',      'billing'),
    ('billing_adjustments.view',   'View billing adjustment log',               'billing'),
    ('billing_adjustments.create', 'Create manual billing adjustments',         'billing');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'chargebacks.view',
           'chargebacks.create',
           'chargebacks.update',
           'billing_adjustments.view',
           'billing_adjustments.create'
       )
WHERE  r.name = 'admin';

-- billing: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'chargebacks.view',
           'chargebacks.create',
           'chargebacks.update',
           'billing_adjustments.view',
           'billing_adjustments.create'
       )
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'chargebacks.view',
           'billing_adjustments.view'
       )
WHERE  r.name = 'support';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'chargebacks.view',
           'billing_adjustments.view'
       )
WHERE  r.name = 'readonly';
