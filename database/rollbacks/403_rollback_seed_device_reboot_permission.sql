-- =============================================================================
-- Rollback 403: remove the devices.reboot permission and its grants
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'devices.reboot';

DELETE FROM permissions WHERE name = 'devices.reboot';
