-- =============================================================================
-- Migration 298: NOC, Work Order, Technician Tracking and Ticket extension
--               permissions — §12
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'noc.view', 'View NOC dashboard', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'noc.view');

INSERT INTO permissions (name, description, module)
SELECT 'work_orders.view', 'View work orders', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_orders.view');

INSERT INTO permissions (name, description, module)
SELECT 'work_orders.create', 'Create work orders', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_orders.create');

INSERT INTO permissions (name, description, module)
SELECT 'work_orders.update', 'Update work orders', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_orders.update');

INSERT INTO permissions (name, description, module)
SELECT 'work_orders.delete', 'Delete work orders', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_orders.delete');

INSERT INTO permissions (name, description, module)
SELECT 'work_order_materials.view', 'View material usage logs', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_materials.view');

INSERT INTO permissions (name, description, module)
SELECT 'work_order_materials.create', 'Log material usage', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_materials.create');

INSERT INTO permissions (name, description, module)
SELECT 'work_order_materials.delete', 'Remove material log entries', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_materials.delete');

INSERT INTO permissions (name, description, module)
SELECT 'technician_tracking.view', 'View technician positions and history', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'technician_tracking.view');

INSERT INTO permissions (name, description, module)
SELECT 'technician_tracking.ingest', 'Submit GPS breadcrumbs (mobile client)', 'noc'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'technician_tracking.ingest');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_relations.view', 'View ticket relations', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_relations.view');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_relations.manage', 'Create and delete ticket relations', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_relations.manage');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_time_logs.view', 'View time logs', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_time_logs.view');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_time_logs.manage', 'Create and edit time logs', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_time_logs.manage');

-- admin: all 14
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'noc.view',
  'work_orders.view','work_orders.create','work_orders.update','work_orders.delete',
  'work_order_materials.view','work_order_materials.create','work_order_materials.delete',
  'technician_tracking.view','technician_tracking.ingest',
  'ticket_relations.view','ticket_relations.manage',
  'ticket_time_logs.view','ticket_time_logs.manage'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- support: view/create/update work orders, materials view/create, tracking.view, relations, time_logs, noc.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'noc.view',
  'work_orders.view','work_orders.create','work_orders.update',
  'work_order_materials.view','work_order_materials.create',
  'technician_tracking.view',
  'ticket_relations.view','ticket_relations.manage',
  'ticket_time_logs.view','ticket_time_logs.manage'
)
WHERE r.name = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: work_orders view/update, materials view/create, tracking view/ingest, time_logs view/manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'work_orders.view','work_orders.update',
  'work_order_materials.view','work_order_materials.create',
  'technician_tracking.view','technician_tracking.ingest',
  'ticket_time_logs.view','ticket_time_logs.manage'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: view-only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'noc.view',
  'work_orders.view',
  'work_order_materials.view',
  'technician_tracking.view',
  'ticket_relations.view',
  'ticket_time_logs.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
