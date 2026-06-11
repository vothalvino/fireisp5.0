-- Rollback 222: Remove chargeback and billing adjustment RBAC permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'chargebacks.view',
    'chargebacks.create',
    'chargebacks.update',
    'billing_adjustments.view',
    'billing_adjustments.create'
);

DELETE FROM permissions WHERE name IN (
    'chargebacks.view',
    'chargebacks.create',
    'chargebacks.update',
    'billing_adjustments.view',
    'billing_adjustments.create'
);
