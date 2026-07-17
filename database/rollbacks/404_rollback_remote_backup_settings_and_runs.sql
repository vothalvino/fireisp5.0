-- =============================================================================
-- Rollback 404: remove remote backup settings/runs tables and their permissions
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('backup_settings.view', 'backup_settings.update');

DELETE FROM permissions WHERE name IN ('backup_settings.view', 'backup_settings.update');

DROP TABLE IF EXISTS backup_runs;
DROP TABLE IF EXISTS backup_settings;
