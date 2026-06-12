-- =============================================================================
-- Migration 311: Reporting & Analytics permissions seed — §15
-- =============================================================================

-- reports module
INSERT INTO permissions (name, description, module)
SELECT 'reports.view', 'View and run standard reports', 'reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'reports.view');

INSERT INTO permissions (name, description, module)
SELECT 'reports.generate', 'Generate and export reports', 'reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'reports.generate');

INSERT INTO permissions (name, description, module)
SELECT 'reports.schedule', 'Create and manage scheduled reports', 'reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'reports.schedule');

INSERT INTO permissions (name, description, module)
SELECT 'reports.export', 'Export report data as CSV/XLSX/PDF', 'reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'reports.export');

INSERT INTO permissions (name, description, module)
SELECT 'reports.manage_definitions', 'Manage report definitions and templates', 'reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'reports.manage_definitions');

-- dashboard_widgets module
INSERT INTO permissions (name, description, module)
SELECT 'dashboard_widgets.view', 'View dashboard widgets', 'dashboard_widgets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dashboard_widgets.view');

INSERT INTO permissions (name, description, module)
SELECT 'dashboard_widgets.manage', 'Create, update, and delete dashboard widgets', 'dashboard_widgets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dashboard_widgets.manage');

-- custom_reports module
INSERT INTO permissions (name, description, module)
SELECT 'custom_reports.view', 'View custom reports', 'custom_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'custom_reports.view');

INSERT INTO permissions (name, description, module)
SELECT 'custom_reports.create', 'Create new custom reports', 'custom_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'custom_reports.create');

INSERT INTO permissions (name, description, module)
SELECT 'custom_reports.execute', 'Execute custom SQL reports against a read replica', 'custom_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'custom_reports.execute');

INSERT INTO permissions (name, description, module)
SELECT 'custom_reports.manage', 'Update and delete custom reports', 'custom_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'custom_reports.manage');

-- ---------------------------------------------------------------------------
-- Role assignments
-- ---------------------------------------------------------------------------

-- admin: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'reports.view','reports.generate','reports.schedule','reports.export','reports.manage_definitions',
  'dashboard_widgets.view','dashboard_widgets.manage',
  'custom_reports.view','custom_reports.create','custom_reports.execute','custom_reports.manage'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- billing: view + generate + schedule + export + widget view/manage + custom view/create/execute
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'reports.view','reports.generate','reports.schedule','reports.export',
  'dashboard_widgets.view','dashboard_widgets.manage',
  'custom_reports.view','custom_reports.create','custom_reports.execute'
)
WHERE r.name = 'billing'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: view + widget view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'reports.view',
  'dashboard_widgets.view',
  'custom_reports.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- support: view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'reports.view',
  'dashboard_widgets.view'
)
WHERE r.name = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'reports.view',
  'dashboard_widgets.view',
  'custom_reports.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
