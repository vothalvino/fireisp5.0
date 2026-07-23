-- Rollback 413 — remove the four CPE model SNMP templates.
-- snmp_profile_oids rows cascade on profile delete (fk ON DELETE CASCADE).
-- Restricted to the exact seeded names; user-created profiles are untouched.
DELETE FROM snmp_profiles
 WHERE name IN (
   'Ubiquiti LiteBeam 5AC Gen2',
   'Ubiquiti PowerBeam M5-400',
   'Ubiquiti airCube ISP',
   'Ruijie RG-EW1300G'
 );
