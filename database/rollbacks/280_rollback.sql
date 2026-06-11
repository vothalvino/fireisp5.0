-- =============================================================================
-- Rollback 280: Remove §9.1 Wireless Vendor SNMP Profile Seeds
-- =============================================================================
-- Reverses migration 280.
-- Removes snmp_profiles and their OIDs for Mimosa Networks, Tarana Wireless,
-- Radwin, and Siklu.
-- Also removes the RF metric OID extensions added to Ubiquiti airOS and
-- MikroTik RouterOS profiles.
--
-- NOTE: OID rows cascade-delete when the profile is deleted (FK ON DELETE CASCADE
-- on snmp_profile_oids.profile_id). For the Ubiquiti/MikroTik extensions, we
-- delete only the specific OIDs added in migration 280.
-- =============================================================================

-- Remove extended RF OIDs from Ubiquiti airOS
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name = 'Ubiquiti airOS'
  AND spo.oid IN (
    '1.3.6.1.4.1.41112.1.4.5.1.4',
    '1.3.6.1.4.1.41112.1.4.5.1.11',
    '1.3.6.1.4.1.41112.1.4.5.1.7',
    '1.3.6.1.4.1.41112.1.4.5.1.6',
    '1.3.6.1.4.1.41112.1.4.5.1.19',
    '1.3.6.1.4.1.41112.1.4.5.1.20'
  );

-- Remove extended RF OIDs from MikroTik RouterOS
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name = 'MikroTik RouterOS'
  AND spo.oid IN (
    '1.3.6.1.4.1.14988.1.1.1.2.1.13',
    '1.3.6.1.4.1.14988.1.1.1.3.1.9',
    '1.3.6.1.4.1.14988.1.1.1.2.1.8',
    '1.3.6.1.4.1.14988.1.1.1.2.1.9'
  );

-- Delete new vendor profiles (OID rows cascade via FK)
DELETE FROM snmp_profiles WHERE name IN (
    'Mimosa Networks',
    'Tarana Wireless',
    'Radwin',
    'Siklu'
);
