-- =============================================================================
-- Rollback 253: Remove §6.1-6.3 SNMP discovery permissions
-- =============================================================================
-- Reverses migration 253.
-- role_permissions rows must be deleted before permissions rows (FK child).
-- =============================================================================

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE name IN (
        'device_groups.view',
        'device_groups.create',
        'device_groups.update',
        'device_groups.delete',
        'discovery_scans.view',
        'discovery_scans.create',
        'discovery_scans.update',
        'discovery_scans.delete',
        'trap_forwarding.view',
        'trap_forwarding.create',
        'trap_forwarding.update',
        'trap_forwarding.delete'
    )
);

DELETE FROM permissions
WHERE name IN (
    'device_groups.view',
    'device_groups.create',
    'device_groups.update',
    'device_groups.delete',
    'discovery_scans.view',
    'discovery_scans.create',
    'discovery_scans.update',
    'discovery_scans.delete',
    'trap_forwarding.view',
    'trap_forwarding.create',
    'trap_forwarding.update',
    'trap_forwarding.delete'
);
