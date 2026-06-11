-- Migration 218: Seed RBAC permissions for refund requests

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('refund_requests.view',    'View refund requests',              'billing'),
    ('refund_requests.create',  'Create and update refund requests', 'billing'),
    ('refund_requests.review',  'Review (approve/reject) refund requests', 'billing'),
    ('refund_requests.process', 'Process approved refund requests',  'billing');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'refund_requests.view',
           'refund_requests.create',
           'refund_requests.review',
           'refund_requests.process'
       )
WHERE  r.name = 'admin';

-- billing: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'refund_requests.view',
           'refund_requests.create',
           'refund_requests.review',
           'refund_requests.process'
       )
WHERE  r.name = 'billing';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('refund_requests.view')
WHERE  r.name = 'support';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('refund_requests.view')
WHERE  r.name = 'readonly';
