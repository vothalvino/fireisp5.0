-- Rollback 207: Remove late fee permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('late_fees.view', 'late_fees.manage');

DELETE FROM permissions
WHERE name IN ('late_fees.view', 'late_fees.manage');
