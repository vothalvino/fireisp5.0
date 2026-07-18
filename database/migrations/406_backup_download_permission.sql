-- =============================================================================
-- Migration 406 — backup_settings.download permission
-- =============================================================================
-- The /backups page gains a Download button for the local backup files
-- (GET /backup-settings/download/{filename}). A backup file IS the entire
-- customer database, so downloading one gets its own explicit slug rather
-- than riding on backup_settings.view — the act is auditable and grantable
-- on its own. Granted to admin + super_admin ONLY, mirroring migrations
-- 386/404 (infrastructure credential/exfiltration surface, excluded from
-- readonly/auditor's blanket *.view wildcard).
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('backup_settings.download', 'Download database backup files (the full database) from the /backups page', 'settings');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name = 'backup_settings.download'
WHERE r.name IN ('admin', 'super_admin');
