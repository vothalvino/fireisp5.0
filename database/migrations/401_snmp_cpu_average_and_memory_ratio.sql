-- =============================================================================
-- Migration 401 — Multi-core CPU averaging + RAM-matched memory percentage
-- =============================================================================
-- Migration 398 fixed the crash (hrStorageUsed, a raw HOST-RESOURCES-MIB
-- storage-allocation-unit count, was seeded as a bare scalar GET straight into
-- the SMALLINT memory_usage "percentage" column and overflowed it) by simply
-- REMOVING memory_usage collection for the two profiles that had it. That
-- deferred the real fix ("the transform column can't express a two-OID
-- ratio") — this migration ships it. Separately, hrProcessorLoad (also
-- HOST-RESOURCES-MIB, table-indexed by hrDeviceIndex under hrProcessorTable)
-- is STILL seeded as a bare scalar GET into cpu_usage: on real hardware a
-- bare GET against a table OID (no trailing instance index) returns
-- NoSuchName. snmpGet()'s varbind-error check already skips that safely (it
-- never crashed a poll), but cpu_usage has silently never populated for any
-- device on the affected profiles since migration 031/252 shipped.
--
-- Live-verified against a real RouterOS lab device (net-snmp, reproducible):
--   - hrProcessorTable (walk 1.3.6.1.2.1.25.3.3.1.2) must be WALKED, not
--     GET; returns one row per processor core.
--   - hrStorageTable: walking hrStorageType (1.3.6.1.2.1.25.2.3.1.2),
--     hrStorageUsed (1.3.6.1.2.1.25.2.3.1.6), and hrStorageSize
--     (1.3.6.1.2.1.25.2.3.1.5) returns multiple rows (RAM, disk, possibly
--     swap/buffers) correlated by a shared trailing hrStorageIndex — the
--     same "match by trailing OID index" pattern already used for
--     per-interface metrics (ifIndex across if_in_octets/if_out_octets
--     walks). The row whose hrStorageType equals hrStorageRam
--     (1.3.6.1.2.1.25.2.1.2) is the RAM row; (used/size)*100 for THAT row
--     only gave a believable 300924/1048576 = 28.70% on the lab device —
--     allocation units cancel because both operands come from the same row.
--     A disk row (hrStorageType=hrStorageFixedDisk, 1.3.6.1.2.1.25.2.1.4)
--     present in the same walk is correctly ignored, not averaged in.
--
-- DESIGN — asymmetric on purpose (see CLAUDE.md's guidance against building
-- a generic mechanism for ~2 known standard-MIB patterns):
--   1. CPU is GENERIC/data-driven: a new snmp_profile_oids.aggregate column
--      (only meaningful when is_per_interface=TRUE) means "walk this OID's
--      subtree and reduce every returned row to one averaged device-level
--      value" — reusable for any future averaged multi-instance metric, not
--      hardcoded to CPU. src/services/snmpPoller.js's collectTableAverage().
--   2. Memory is a HARDCODED one-off, NOT schema-driven: snmpPoller.js
--      dispatches purely on `metric_column === 'memory_usage' &&
--      is_per_interface === TRUE`; the re-seeded row's `oid` column below is
--      cosmetic/label-only — collectHrMemoryPercent() internally hardcodes
--      and walks all three HOST-RESOURCES-MIB OIDs itself. A generic
--      "match by companion OID value" schema mechanism is deliberately not
--      built for a pattern used exactly once.
--
-- INVESTIGATION (per this PR's brief): grepping every migration for both
-- OIDs confirms exactly three hrProcessorLoad -> cpu_usage seed rows exist
-- (migration 031's 'Generic IF-MIB' and 'MikroTik RouterOS', and migration
-- 252's 'Generic Switch' — label 'HOST-RESOURCES-MIB: hrProcessorLoad',
-- ~252:192), and exactly two hrStorageUsed -> memory_usage seed rows ever
-- existed (031's 'Generic IF-MIB' and 'MikroTik RouterOS' — both already
-- hard-deleted by migration 398). Migration 252's 'Generic Switch' profile
-- was NOT part of 398's by-name DELETE list, but it never seeded a
-- memory_usage OID at all (only cpu_usage) — so there is no still-live
-- crashing-poll residual from migration 252 to fix here. It DOES share the
-- same silent-never-populates cpu_usage bug, which Part 1 below fixes for
-- it automatically (matched by oid+metric_column, not profile name).
--
-- Requires: 030_create_snmp_profile_oids_table, 398_fix_memory_usage_seed_and_seed_reachability_oid
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 0: add snmp_profile_oids.aggregate (idempotent; INFORMATION_SCHEMA-
-- guarded stored procedure, mirroring migrations 371/374/398's pattern)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_401_add_aggregate_to_snmp_profile_oids;
DELIMITER //
CREATE PROCEDURE migration_401_add_aggregate_to_snmp_profile_oids()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_profile_oids'
      AND COLUMN_NAME  = 'aggregate'
  ) THEN
    ALTER TABLE snmp_profile_oids
      ADD COLUMN aggregate BOOLEAN NOT NULL DEFAULT FALSE
          COMMENT 'Only meaningful when is_per_interface=TRUE: TRUE means walk this OID subtree and reduce every returned row to ONE averaged device-level value (e.g. multi-core hrProcessorLoad) instead of one row per index (migration 401)'
          AFTER is_per_interface;
  END IF;
END //
DELIMITER ;
CALL migration_401_add_aggregate_to_snmp_profile_oids();
DROP PROCEDURE IF EXISTS migration_401_add_aggregate_to_snmp_profile_oids;

-- -----------------------------------------------------------------------------
-- Part 1: hrProcessorLoad now walked + averaged, not bare-GET. Data-driven —
-- matches by oid+metric_column, so it covers all three affected profiles
-- (Generic IF-MIB, MikroTik RouterOS, Generic Switch) without naming them.
-- Idempotent (plain UPDATE — re-running finds nothing left to flip).
-- -----------------------------------------------------------------------------
UPDATE snmp_profile_oids
SET is_per_interface = TRUE, aggregate = TRUE
WHERE oid = '1.3.6.1.2.1.25.3.3.1.2'
  AND metric_column = 'cpu_usage'
  AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Part 2: re-seed memory_usage for the two profiles migration 398 stripped it
-- from. `oid` is label/identification only (see design note above) —
-- src/services/snmpPoller.js hardcodes the three real walked OIDs internally
-- in collectHrMemoryPercent() and never reads this row's `oid` value to
-- drive the walk. NOT EXISTS-guarded — safe to re-run.
-- -----------------------------------------------------------------------------
INSERT INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT
    p.id,
    '1.3.6.1.2.1.25.2.3.1.6',
    'memory_usage',
    'Memory Used % (hrStorageTable RAM row)',
    'gauge',
    TRUE,
    FALSE,
    NULL,
    60
FROM snmp_profiles p
WHERE p.name IN ('Generic IF-MIB', 'MikroTik RouterOS')
  AND NOT EXISTS (
    SELECT 1 FROM snmp_profile_oids spo
    WHERE spo.profile_id = p.id
      AND spo.oid = '1.3.6.1.2.1.25.2.3.1.6'
      AND spo.metric_column = 'memory_usage'
      AND spo.deleted_at IS NULL
  );

-- END OF MIGRATION 401
