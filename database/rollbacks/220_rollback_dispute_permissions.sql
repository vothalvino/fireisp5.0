-- Rollback 220: Remove billing dispute RBAC permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'billing_disputes.view',
    'billing_disputes.create',
    'billing_disputes.update'
);

DELETE FROM permissions WHERE name IN (
    'billing_disputes.view',
    'billing_disputes.create',
    'billing_disputes.update'
);
