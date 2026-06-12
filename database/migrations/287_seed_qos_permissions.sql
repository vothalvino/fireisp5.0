-- =============================================================================
-- Migration 287: QoS / Speed Profile RBAC permissions seed — §10.1
-- =============================================================================
-- Permissions seeded:
--   quality_classes.view / create / update / delete  (4)
--   queue_tree_nodes.view / create / update / delete  (4)
--   queue_tree_nodes.export  (1)
-- Total: 9 permissions
--
-- Role matrix:
--   admin       → all 9
--   technician  → view permissions + queue_tree_nodes.export
--   readonly    → view permissions only (3)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions (idempotent by name)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'quality_classes.view',   'View QoS quality/priority classes',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quality_classes.view');

INSERT INTO permissions (name, description, module)
SELECT 'quality_classes.create', 'Create QoS quality/priority classes',  'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quality_classes.create');

INSERT INTO permissions (name, description, module)
SELECT 'quality_classes.update', 'Update QoS quality/priority classes',  'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quality_classes.update');

INSERT INTO permissions (name, description, module)
SELECT 'quality_classes.delete', 'Delete QoS quality/priority classes',  'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quality_classes.delete');

INSERT INTO permissions (name, description, module)
SELECT 'queue_tree_nodes.view',   'View queue tree nodes',                'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'queue_tree_nodes.view');

INSERT INTO permissions (name, description, module)
SELECT 'queue_tree_nodes.create', 'Create queue tree nodes',              'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'queue_tree_nodes.create');

INSERT INTO permissions (name, description, module)
SELECT 'queue_tree_nodes.update', 'Update queue tree nodes',              'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'queue_tree_nodes.update');

INSERT INTO permissions (name, description, module)
SELECT 'queue_tree_nodes.delete', 'Delete queue tree nodes',              'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'queue_tree_nodes.delete');

INSERT INTO permissions (name, description, module)
SELECT 'queue_tree_nodes.export', 'Export MikroTik queue tree configuration', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'queue_tree_nodes.export');

-- ---------------------------------------------------------------------------
-- Assign to admin role (all 9)
-- ---------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'quality_classes.view','quality_classes.create','quality_classes.update','quality_classes.delete',
  'queue_tree_nodes.view','queue_tree_nodes.create','queue_tree_nodes.update','queue_tree_nodes.delete',
  'queue_tree_nodes.export'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- ---------------------------------------------------------------------------
-- Assign to technician role (views + export)
-- ---------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'quality_classes.view',
  'queue_tree_nodes.view','queue_tree_nodes.export'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- ---------------------------------------------------------------------------
-- Assign to readonly role (views only)
-- ---------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'quality_classes.view',
  'queue_tree_nodes.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
