-- Migration 210: Seed RBAC permissions for tax reports

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('billing.tax_reports', 'Generate and download tax reports', 'billing');

-- admin: tax reports
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('billing.tax_reports')
WHERE  r.name = 'admin';

-- billing: tax reports
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('billing.tax_reports')
WHERE  r.name = 'billing';
