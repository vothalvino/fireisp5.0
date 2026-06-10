-- Migration 207: Seed RBAC permissions for late fees

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('late_fees.view',   'View late fee rules and applied late fees',          'billing'),
    ('late_fees.manage', 'Create, update, and delete late fee rules; apply or reverse late fees', 'billing');

-- admin: view + manage
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('late_fees.view', 'late_fees.manage')
WHERE  r.name = 'admin';

-- billing: view + manage
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('late_fees.view', 'late_fees.manage')
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('late_fees.view')
WHERE  r.name = 'support';

-- technician: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('late_fees.view')
WHERE  r.name = 'technician';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('late_fees.view')
WHERE  r.name = 'readonly';
