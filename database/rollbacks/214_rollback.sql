-- Rollback 214: Remove cash reconciliation RBAC permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'cash_reconciliation.view',
    'cash_reconciliation.create',
    'cash_reconciliation.update',
    'cash_reconciliation.approve'
);

DELETE FROM permissions
WHERE name IN (
    'cash_reconciliation.view',
    'cash_reconciliation.create',
    'cash_reconciliation.update',
    'cash_reconciliation.approve'
);
