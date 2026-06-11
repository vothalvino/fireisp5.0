-- Rollback 210: Remove tax report permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('billing.tax_reports');

DELETE FROM permissions
WHERE name IN ('billing.tax_reports');
