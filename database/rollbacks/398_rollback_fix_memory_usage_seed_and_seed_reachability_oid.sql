-- =============================================================================
-- Rollback 398: restore the broken memory_usage seed rows
-- =============================================================================
-- Re-seeding the broken hrStorageUsed -> memory_usage mapping is generally
-- undesirable (it is the root cause this migration fixes), but a rollback
-- must restore the pre-migration schema/seed state exactly so the migration
-- is safely reversible.
--
-- Part 2 of the forward migration (the idempotent sysUpTime NOT EXISTS
-- backfill) is intentionally NOT reversed here: in the standard migration
-- order migration 372 already seeded 1.3.6.1.2.1.1.3.0 for every profile
-- that exists by the time 398 runs, so 398's Part 2 inserts zero rows in
-- practice -- there is nothing for this rollback to undo without also
-- deleting rows that belong to migration 372 (whose own rollback already
-- owns that deletion). If a future out-of-band profile ever causes 398's
-- Part 2 to insert a real row, leaving it in place on rollback is the safer
-- failure mode (an extra reachability OID is harmless; deleting one that
-- pre-dates this migration is not).
--
-- Part 1 reversal: restore the original (broken) hrStorageUsed seed rows
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, '1.3.6.1.2.1.25.2.3.1.6', 'memory_usage', 'Memory Used (storage units)', 'gauge', FALSE, NULL, 60
FROM snmp_profiles p
WHERE p.name = 'Generic IF-MIB';

INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, '1.3.6.1.2.1.25.2.3.1.6', 'memory_usage', 'Memory Used (hrStorageUsed)', 'gauge', FALSE, NULL, 60
FROM snmp_profiles p
WHERE p.name = 'MikroTik RouterOS';
