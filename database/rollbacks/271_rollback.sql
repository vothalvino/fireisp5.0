-- =============================================================================
-- Rollback 271: Remove §7.3 PON Port Management permissions
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'olt_ports.shutdown',
    'olt_ports.configure_mode',
    'olt_ports.utilization',
    'olt_ports.power_budget',
    'onu_migration_jobs.view',
    'onu_migration_jobs.create',
    'onu_migration_jobs.update',
    'onu_migration_jobs.delete'
);

DELETE FROM permissions WHERE name IN (
    'olt_ports.shutdown',
    'olt_ports.configure_mode',
    'olt_ports.utilization',
    'olt_ports.power_budget',
    'onu_migration_jobs.view',
    'onu_migration_jobs.create',
    'onu_migration_jobs.update',
    'onu_migration_jobs.delete'
);
