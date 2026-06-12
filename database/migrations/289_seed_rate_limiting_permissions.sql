-- =============================================================================
-- Migration 289: Rate Limiting RBAC permissions seed — §10.2
-- =============================================================================
-- Permissions seeded:
--   rate_limit_templates.view / create / update / delete  (4)
--   protocol_shaping_rules.view / create / update / delete  (4)
-- Total: 8 permissions
--
-- Role matrix:
--   admin       → all 8
--   technician  → view + rate_limit_templates.create/update + protocol_shaping_rules.create/update
--   readonly    → view permissions only (2)
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'rate_limit_templates.view',   'View rate-limit templates per service type',  'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rate_limit_templates.view');

INSERT INTO permissions (name, description, module)
SELECT 'rate_limit_templates.create', 'Create rate-limit templates',                 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rate_limit_templates.create');

INSERT INTO permissions (name, description, module)
SELECT 'rate_limit_templates.update', 'Update rate-limit templates',                 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rate_limit_templates.update');

INSERT INTO permissions (name, description, module)
SELECT 'rate_limit_templates.delete', 'Delete rate-limit templates',                 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rate_limit_templates.delete');

INSERT INTO permissions (name, description, module)
SELECT 'protocol_shaping_rules.view',   'View per-protocol/port shaping rules',      'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'protocol_shaping_rules.view');

INSERT INTO permissions (name, description, module)
SELECT 'protocol_shaping_rules.create', 'Create per-protocol/port shaping rules',    'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'protocol_shaping_rules.create');

INSERT INTO permissions (name, description, module)
SELECT 'protocol_shaping_rules.update', 'Update per-protocol/port shaping rules',    'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'protocol_shaping_rules.update');

INSERT INTO permissions (name, description, module)
SELECT 'protocol_shaping_rules.delete', 'Delete per-protocol/port shaping rules',    'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'protocol_shaping_rules.delete');

-- admin: all 8
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'rate_limit_templates.view','rate_limit_templates.create',
  'rate_limit_templates.update','rate_limit_templates.delete',
  'protocol_shaping_rules.view','protocol_shaping_rules.create',
  'protocol_shaping_rules.update','protocol_shaping_rules.delete'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: views + create/update
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'rate_limit_templates.view','rate_limit_templates.create','rate_limit_templates.update',
  'protocol_shaping_rules.view','protocol_shaping_rules.create','protocol_shaping_rules.update'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: views only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'rate_limit_templates.view',
  'protocol_shaping_rules.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
