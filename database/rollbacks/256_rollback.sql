-- =============================================================================
-- Rollback 256: Remove seeded OIDs added by migration 256
-- =============================================================================
-- Deletes the specific OID rows inserted in migration 256 by matching on
-- the oid value joined with the snmp_profiles name.
-- Uses DELETE ... JOIN so only the exact rows for the exact profiles are removed.
-- =============================================================================

-- MikroTik RouterOS OIDs
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE p.name = 'MikroTik RouterOS'
  AND spo.oid IN (
    '1.3.6.1.4.1.14988.1.1.3.5',
    '1.3.6.1.4.1.14988.1.1.3.9',
    '1.3.6.1.4.1.14988.1.1.3.11'
  );

-- SFP Diagnostics OIDs
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE p.name = 'SFP Diagnostics'
  AND spo.oid IN (
    '1.3.6.1.4.1.2636.3.60.1.1.1.1.34',
    '1.3.6.1.4.1.2636.3.60.1.1.1.1.7',
    '1.3.6.1.4.1.2636.3.60.1.1.1.1.6'
  );

-- Generic Switch OIDs
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE p.name = 'Generic Switch'
  AND spo.oid IN (
    '1.3.6.1.2.1.2.2.1.13',
    '1.3.6.1.2.1.2.2.1.19',
    '1.3.6.1.4.1.9.9.402.1.2.1.14'
  );

-- Generic UPS OIDs
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE p.name = 'Generic UPS'
  AND spo.oid IN (
    '1.3.6.1.2.1.33.1.2.4.0',
    '1.3.6.1.2.1.33.1.2.3.0'
  );

-- Environmental Sensors OIDs
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE p.name = 'Environmental Sensors'
  AND spo.oid IN (
    '1.3.6.1.4.1.17095.5.2.0',
    '1.3.6.1.4.1.17095.5.1.0'
  );
