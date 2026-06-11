-- Migration 209: Seed RBAC permissions for payment reminders

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('payment_reminders.view',   'View payment reminder settings and logs',              'billing'),
    ('payment_reminders.manage', 'Configure payment reminder schedules and channels',    'billing');

-- admin: view + manage
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_reminders.view', 'payment_reminders.manage')
WHERE  r.name = 'admin';

-- billing: view + manage
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_reminders.view', 'payment_reminders.manage')
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_reminders.view')
WHERE  r.name = 'support';

-- technician: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_reminders.view')
WHERE  r.name = 'technician';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('payment_reminders.view')
WHERE  r.name = 'readonly';
