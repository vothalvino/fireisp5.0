-- Rollback 212: Remove payment plan RBAC permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'payment_plans.view',
    'payment_plans.create',
    'payment_plans.update',
    'payment_plans.delete'
);

DELETE FROM permissions
WHERE name IN (
    'payment_plans.view',
    'payment_plans.create',
    'payment_plans.update',
    'payment_plans.delete'
);
