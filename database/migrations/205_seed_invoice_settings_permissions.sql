-- Migration 205: Seed RBAC permissions for invoice_settings (§2.2 Phase B)

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('invoice_settings.view',   'View invoice branding and PDF settings for an organisation', 'billing'),
    ('invoice_settings.update', 'Update invoice branding and PDF settings for an organisation', 'billing');

-- admin: view + update
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('invoice_settings.view', 'invoice_settings.update')
WHERE  r.name = 'admin';

-- billing: view + update
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('invoice_settings.view', 'invoice_settings.update')
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('invoice_settings.view')
WHERE  r.name = 'support';

-- technician: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('invoice_settings.view')
WHERE  r.name = 'technician';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('invoice_settings.view')
WHERE  r.name = 'readonly';
