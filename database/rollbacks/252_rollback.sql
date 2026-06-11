-- =============================================================================
-- Rollback 252: Remove vendor SNMP profile seeds
-- =============================================================================
-- Reverses migration 252.
-- OID rows must be deleted before profile rows (FK constraint).
-- =============================================================================

DELETE FROM snmp_profile_oids
WHERE profile_id IN (
    SELECT id FROM snmp_profiles
    WHERE name IN (
        'Cisco IOS',
        'Juniper JunOS',
        'Huawei VRP',
        'ZTE ZXAN',
        'Generic Switch',
        'Generic UPS',
        'SFP Diagnostics',
        'Environmental Sensors'
    )
);

DELETE FROM snmp_profiles
WHERE name IN (
    'Cisco IOS',
    'Juniper JunOS',
    'Huawei VRP',
    'ZTE ZXAN',
    'Generic Switch',
    'Generic UPS',
    'SFP Diagnostics',
    'Environmental Sensors'
);
