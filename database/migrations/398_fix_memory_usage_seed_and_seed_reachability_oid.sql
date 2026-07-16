-- =============================================================================
-- Migration 398 — Remove broken memory_usage OID seed; guarantee every SNMP
-- profile has a scalar reachability anchor
-- =============================================================================
-- Part 1: delete the hrStorageUsed -> memory_usage seed rows.
--
-- snmp_profile_oids seeded 1.3.6.1.2.1.25.2.3.1.6 (hrStorageUsed — HOST-
-- RESOURCES-MIB, RAW allocation units, e.g. "302552" on a device reporting
-- storage in 1KB units) directly into snmp_metrics.memory_usage, a SMALLINT
-- documented as "Memory utilization percentage" (database/schema.sql:1562).
-- hrStorageUsed is NEVER a percentage on its own -- it must be divided by the
-- matching hrStorageSize (a second OID, e.g. 1.3.6.1.2.1.25.2.3.1.5) to derive
-- a 0-100 value. A device reporting 302552 storage units used out of ~1GB
-- total capacity (hrStorageAllocationUnits-scaled) landed a raw ~28.9%-meaning
-- value as literally "302552" into a SMALLINT (max 32767) -> MySQL threw
-- "Out of range value for column 'memory_usage'" -> the whole pollDevice()
-- INSERT rejected -> deviceStatusService recorded a POLL FAILURE for a device
-- that answered SNMP perfectly, per-interface metrics were never attempted for
-- that poll, and enough consecutive failures flipped the device to 'offline'
-- (migration 397's threshold) -- three symptoms from one bad seed row.
--
-- This migration removes the seed rows for the two profiles that shipped
-- with it (migration 031): 'Generic IF-MIB' and 'MikroTik RouterOS'. A hard
-- DELETE is used (not a soft-delete) because these rows never produced valid
-- data -- there is nothing worth retaining or auditing. memory_usage
-- collection stops for these two profiles until a proper two-OID
-- (hrStorageUsed / hrStorageSize) percentage feature ships; that feature is
-- intentionally NOT implemented here (the snmp_profile_oids.transform column
-- is a single-value expression and cannot express a ratio between two OIDs
-- read in the same poll) -- see the PR description for the deferral.
--
-- Part 2: seed the sysUpTime scalar OID (migration 372's OID/column, same
-- 1.3.6.1.2.1.1.3.0 -> uptime_ticks mapping) for every profile that still
-- lacks ANY scalar OID after Part 1. Every profile needs at least one scalar
-- OID so the poller has a positive reachability signal (see snmpPoller.js's
-- "device unreachable: no OIDs responded" guard) -- Generic IF-MIB and
-- MikroTik RouterOS both had cpu_usage already, so in practice this INSERT
-- is a no-op for them and only protects a hypothetical future profile with
-- zero scalar OIDs (e.g. a custom org-created profile that was never routed
-- through migration 372's one-time backfill). Idempotent via NOT EXISTS,
-- mirroring migration 372's own pattern exactly.
--
-- Requires: 031_seed_snmp_profiles, 372_add_uptime_metric_and_seed_oids
-- =============================================================================

-- Part 1: remove the broken hrStorageUsed -> memory_usage seed rows
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE spo.oid = '1.3.6.1.2.1.25.2.3.1.6'
  AND spo.metric_column = 'memory_usage'
  AND p.name IN ('Generic IF-MIB', 'MikroTik RouterOS');

-- Part 2: guarantee a scalar reachability anchor (sysUpTime) for every
-- profile that has none (idempotent; matches migration 372's pattern)
INSERT INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    '1.3.6.1.2.1.1.3.0',
    'uptime_ticks',
    'System Uptime (sysUpTime)',
    'timeticks',
    FALSE,
    5
FROM snmp_profiles p
WHERE NOT EXISTS (
    SELECT 1 FROM snmp_profile_oids spo
    WHERE spo.profile_id = p.id
      AND spo.oid = '1.3.6.1.2.1.1.3.0'
);

-- END OF MIGRATION 398
