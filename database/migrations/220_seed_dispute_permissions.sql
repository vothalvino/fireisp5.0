-- Migration 220: Seed RBAC permissions for billing disputes

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('billing_disputes.view',   'View billing disputes and evidence',          'billing'),
    ('billing_disputes.create', 'Open new billing disputes',                   'billing'),
    ('billing_disputes.update', 'Update and resolve billing disputes',         'billing');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'billing_disputes.view',
           'billing_disputes.create',
           'billing_disputes.update'
       )
WHERE  r.name = 'admin';

-- billing: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'billing_disputes.view',
           'billing_disputes.create',
           'billing_disputes.update'
       )
WHERE  r.name = 'billing';

-- support: view + create
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'billing_disputes.view',
           'billing_disputes.create'
       )
WHERE  r.name = 'support';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('billing_disputes.view')
WHERE  r.name = 'readonly';
