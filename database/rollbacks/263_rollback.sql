-- Rollback 263: Remove config management permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'config_templates.view', 'config_templates.create', 'config_templates.update', 'config_templates.delete',
    'config_deployments.view', 'config_deployments.create', 'config_deployments.update',
    'config_backup_schedules.view', 'config_backup_schedules.create', 'config_backup_schedules.update', 'config_backup_schedules.delete',
    'config_compliance.view', 'config_compliance.create', 'config_compliance.update', 'config_compliance.delete', 'config_compliance.run'
);
DELETE FROM permissions WHERE name IN (
    'config_templates.view', 'config_templates.create', 'config_templates.update', 'config_templates.delete',
    'config_deployments.view', 'config_deployments.create', 'config_deployments.update',
    'config_backup_schedules.view', 'config_backup_schedules.create', 'config_backup_schedules.update', 'config_backup_schedules.delete',
    'config_compliance.view', 'config_compliance.create', 'config_compliance.update', 'config_compliance.delete', 'config_compliance.run'
);
