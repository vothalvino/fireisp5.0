-- Rollback 218: Remove refund request RBAC permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'refund_requests.view',
    'refund_requests.create',
    'refund_requests.review',
    'refund_requests.process'
);

DELETE FROM permissions WHERE name IN (
    'refund_requests.view',
    'refund_requests.create',
    'refund_requests.review',
    'refund_requests.process'
);
