-- =============================================================================
-- Rollback 268: Remove FTTH OLT & ONU permissions
-- =============================================================================
-- Removes role_permissions rows first (FK child), then permissions rows.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'olt_management.view',     'olt_management.create',
    'olt_management.update',   'olt_management.delete',
    'olt_ports.view',          'olt_ports.create',
    'olt_ports.update',        'olt_ports.delete',
    'olt_splitters.view',      'olt_splitters.create',
    'olt_splitters.update',    'olt_splitters.delete',
    'onu_management.view',     'onu_management.create',
    'onu_management.update',   'onu_management.delete',
    'onu_profiles.view',       'onu_profiles.create',
    'onu_profiles.update',     'onu_profiles.delete',
    'onu_whitelist.view',      'onu_whitelist.create',
    'onu_whitelist.update',    'onu_whitelist.delete',
    'onu_omci_configs.view',   'onu_omci_configs.create',
    'onu_omci_configs.update', 'onu_omci_configs.delete',
    'onu_firmware_jobs.view',  'onu_firmware_jobs.create',
    'onu_firmware_jobs.update','onu_firmware_jobs.delete'
);

DELETE FROM permissions WHERE name IN (
    'olt_management.view',     'olt_management.create',
    'olt_management.update',   'olt_management.delete',
    'olt_ports.view',          'olt_ports.create',
    'olt_ports.update',        'olt_ports.delete',
    'olt_splitters.view',      'olt_splitters.create',
    'olt_splitters.update',    'olt_splitters.delete',
    'onu_management.view',     'onu_management.create',
    'onu_management.update',   'onu_management.delete',
    'onu_profiles.view',       'onu_profiles.create',
    'onu_profiles.update',     'onu_profiles.delete',
    'onu_whitelist.view',      'onu_whitelist.create',
    'onu_whitelist.update',    'onu_whitelist.delete',
    'onu_omci_configs.view',   'onu_omci_configs.create',
    'onu_omci_configs.update', 'onu_omci_configs.delete',
    'onu_firmware_jobs.view',  'onu_firmware_jobs.create',
    'onu_firmware_jobs.update','onu_firmware_jobs.delete'
);
