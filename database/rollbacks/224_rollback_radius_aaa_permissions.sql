-- =============================================================================
-- FireISP 5.0 — Rollback 224: Remove RADIUS AAA RBAC permissions
-- =============================================================================
-- Reverses migration 224. Removes role_permissions assignments first (FK child),
-- then removes the permission rows.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'subscriber_certificates.view',
    'subscriber_certificates.create',
    'subscriber_certificates.update',
    'subscriber_certificates.revoke',
    'radius.sync'
);

DELETE FROM permissions WHERE name IN (
    'subscriber_certificates.view',
    'subscriber_certificates.create',
    'subscriber_certificates.update',
    'subscriber_certificates.revoke',
    'radius.sync'
);
