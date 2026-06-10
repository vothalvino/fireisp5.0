-- Rollback 205: Remove invoice_settings permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('invoice_settings.view', 'invoice_settings.update');

DELETE FROM permissions
WHERE name IN ('invoice_settings.view', 'invoice_settings.update');
