-- =============================================================================
-- Migration 296: Customer Self-Service Portal RBAC permissions seed — §11
-- =============================================================================
-- Permissions seeded (module='portal'):
--   portal_kb.view / create / update / delete             (4)
--   portal_service_requests.view / update                 (2)
--   portal_push.view / manage                             (2)
-- Total: 8 permissions
--
-- Role matrix:
--   admin      → all 8
--   technician → portal_kb.view/create/update, portal_service_requests.view/update,
--                portal_push.view
--   readonly   → portal_kb.view, portal_service_requests.view, portal_push.view
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'portal_kb.view',   'View knowledge-base articles',   'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_kb.view');

INSERT INTO permissions (name, description, module)
SELECT 'portal_kb.create', 'Create knowledge-base articles', 'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_kb.create');

INSERT INTO permissions (name, description, module)
SELECT 'portal_kb.update', 'Edit knowledge-base articles',   'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_kb.update');

INSERT INTO permissions (name, description, module)
SELECT 'portal_kb.delete', 'Delete knowledge-base articles', 'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_kb.delete');

INSERT INTO permissions (name, description, module)
SELECT 'portal_service_requests.view',   'View client portal service requests',   'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_service_requests.view');

INSERT INTO permissions (name, description, module)
SELECT 'portal_service_requests.update', 'Approve or reject portal service requests', 'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_service_requests.update');

INSERT INTO permissions (name, description, module)
SELECT 'portal_push.view',   'View portal push notification subscriptions', 'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_push.view');

INSERT INTO permissions (name, description, module)
SELECT 'portal_push.manage', 'Dispatch portal push notifications',          'portal'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'portal_push.manage');

-- admin: all 8
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'portal_kb.view','portal_kb.create','portal_kb.update','portal_kb.delete',
  'portal_service_requests.view','portal_service_requests.update',
  'portal_push.view','portal_push.manage'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: kb view/create/update, service_requests view/update, push view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'portal_kb.view','portal_kb.create','portal_kb.update',
  'portal_service_requests.view','portal_service_requests.update',
  'portal_push.view'
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
  'portal_kb.view',
  'portal_service_requests.view',
  'portal_push.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
