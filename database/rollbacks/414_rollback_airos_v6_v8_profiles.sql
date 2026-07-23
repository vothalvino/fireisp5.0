-- Rollback 414 — best-effort restore of the pre-414 airOS profile state.
-- 1. Drop the new v8 profile (OIDs cascade).
DELETE FROM snmp_profiles WHERE name = 'Ubiquiti airOS v8 (airMAX AC)';

-- 2. Rename the corrected profile back.
UPDATE snmp_profiles
   SET name = 'Ubiquiti airOS'
 WHERE name = 'Ubiquiti airOS v6 (airMAX M)'
   AND deleted_at IS NULL;

-- 3. Remove the canonical rows 414 added and restore the soft-deleted originals.
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
 WHERE p.name = 'Ubiquiti airOS'
   AND spo.oid IN ('1.3.6.1.4.1.41112.1.4.5.1.5.1', '1.3.6.1.4.1.41112.1.4.5.1.8.1',
                   '1.3.6.1.4.1.41112.1.4.5.1.7.1', '1.3.6.1.2.1.25.3.3.1.2', '1.3.6.1.2.1.25.2.3.1.6')
   AND spo.deleted_at IS NULL;

UPDATE snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
   SET spo.deleted_at = NULL
 WHERE p.name = 'Ubiquiti airOS'
   AND spo.deleted_at IS NOT NULL
   AND spo.oid LIKE '1.3.6.1.4.1.41112.1.4.5.1.%';

-- 4. LiteBeam template: drop AMQ, restore the soft-deleted wlStat CCQ row.
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
 WHERE p.name = 'Ubiquiti LiteBeam 5AC Gen2'
   AND spo.oid = '1.3.6.1.4.1.41112.1.4.6.1.3.1'
   AND spo.deleted_at IS NULL;

UPDATE snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
   SET spo.deleted_at = NULL
 WHERE p.name = 'Ubiquiti LiteBeam 5AC Gen2'
   AND spo.oid = '1.3.6.1.4.1.41112.1.4.5.1.7.1'
   AND spo.deleted_at IS NOT NULL;
