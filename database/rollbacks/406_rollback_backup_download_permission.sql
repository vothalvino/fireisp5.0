-- =============================================================================
-- Rollback 406: remove the backup_settings.download permission and its grants
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'backup_settings.download';

DELETE FROM permissions WHERE name = 'backup_settings.download';
