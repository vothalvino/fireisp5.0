-- =============================================================================
-- Migration 224: RBAC permissions for subscriber_certificates and radius.sync
-- =============================================================================
-- Implements isp-platform-features.md §3.1 "RADIUS AAA Phase A":
--   Seeds permissions for EAP-TLS certificate management and RADIUS sync,
--   then assigns them to roles.
--
-- Role matrix:
--   admin       — all 5 permissions
--   support     — subscriber_certificates.view only
--   technician  — subscriber_certificates.view only
--   readonly    — subscriber_certificates.view only
--   billing     — none
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('subscriber_certificates.view',   'View subscriber EAP-TLS certificates',          'radius'),
    ('subscriber_certificates.create', 'Issue new subscriber EAP-TLS certificates',     'radius'),
    ('subscriber_certificates.update', 'Update subscriber certificate metadata',         'radius'),
    ('subscriber_certificates.revoke', 'Revoke subscriber EAP-TLS certificates',        'radius'),
    ('radius.sync',                    'Trigger manual RADIUS configuration sync',       'radius');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'subscriber_certificates.view',
           'subscriber_certificates.create',
           'subscriber_certificates.update',
           'subscriber_certificates.revoke',
           'radius.sync'
       )
WHERE  r.name = 'admin';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'subscriber_certificates.view'
       )
WHERE  r.name = 'support';

-- technician: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'subscriber_certificates.view'
       )
WHERE  r.name = 'technician';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'subscriber_certificates.view'
       )
WHERE  r.name = 'readonly';
