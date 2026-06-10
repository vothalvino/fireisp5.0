-- Rollback 209: Remove payment reminder permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('payment_reminders.view', 'payment_reminders.manage');

DELETE FROM permissions
WHERE name IN ('payment_reminders.view', 'payment_reminders.manage');
