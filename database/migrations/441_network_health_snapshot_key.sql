-- =============================================================================
-- Migration 441 — make network_health_snapshots idempotently writable
-- =============================================================================
-- network_health_snapshots has been READ by three places since migration 117
-- and WRITTEN by nothing: no INSERT anywhere in src/, and the
-- `populate_network_health_snapshots` scheduled task returned the string
-- "populated by MySQL scheduled event" — an event that was never written. The
-- task therefore reported SUCCESS every night while doing nothing, and the
-- /network-health page has been empty for its entire existence. A green job
-- feeding a blank page is worse than an obviously missing feature: nobody has a
-- signal that anything is wrong.
--
-- This migration adds the one thing the aggregation needs and the table lacks:
-- a key to upsert against. Without it, a daily job that re-runs — a retry, a
-- backfill, a manual trigger — silently duplicates every row it already wrote,
-- and the page starts double-counting.
--
-- WHY A DISCRIMINATOR COLUMN AT ALL. The natural key is (device_id,
-- network_link_id, snapshot_date), but a snapshot is device-only OR link-only,
-- so one of those two is always NULL — and MySQL treats NULLs in a UNIQUE index
-- as DISTINCT. Two runs for the same device and day would both carry
-- network_link_id NULL and both be accepted, which is precisely the duplication
-- being prevented. Folding NULLs to 0 gives the key a value in every row.
--
-- WHY NOT A GENERATED COLUMN, which is the obvious way to do that: MySQL
-- PROHIBITS ON UPDATE CASCADE and ON DELETE SET NULL on a base column of a
-- generated column, and this table already carries exactly those actions on
-- device_id and network_link_id (fk_network_health_device,
-- fk_network_health_link). Adding a generated column derived from them makes
-- the whole table undefinable — ER_CANNOT_ADD_FOREIGN (1215), which is what
-- four real-MySQL CI jobs reported. The restriction applies to STORED and
-- VIRTUAL alike, so there is no variant of that approach that works.
--
-- So it is a PLAIN column, written by the aggregation alongside every row it
-- inserts. src/services/networkHealthAggregator.js is the only writer of this
-- table, so there is exactly one place that has to keep it consistent.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_441_network_health_snapshot_key;
DELIMITER //
CREATE PROCEDURE migration_441_network_health_snapshot_key()
BEGIN
  -- Any duplicates already present would make ADD UNIQUE KEY fail. There should
  -- be none (nothing has ever written this table), but a hand-populated install
  -- would otherwise hit an error it cannot act on. Keep the lowest id per
  -- subject+date and drop the rest.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_health_snapshots'
      AND INDEX_NAME = 'uq_nhs_subject_date'
  ) THEN
    DELETE s FROM network_health_snapshots s
      JOIN (
        SELECT MIN(id) AS keep_id, COALESCE(device_id, 0) AS d,
               COALESCE(network_link_id, 0) AS l, snapshot_date
          FROM network_health_snapshots
         GROUP BY d, l, snapshot_date
        HAVING COUNT(*) > 1
      ) dup
        ON COALESCE(s.device_id, 0) = dup.d
       AND COALESCE(s.network_link_id, 0) = dup.l
       AND s.snapshot_date = dup.snapshot_date
     WHERE s.id <> dup.keep_id;

    ALTER TABLE network_health_snapshots
      ADD COLUMN subject_key VARCHAR(48) NULL
          COMMENT 'Device/link identity with NULLs folded to 0, so the daily upsert has a key MySQL will not treat as distinct. Written by networkHealthAggregator; NOT generated, because MySQL forbids the ON DELETE SET NULL / ON UPDATE CASCADE this table uses on a generated column base (migration 441)';

    -- Backfill whatever is already there so the unique key can be built.
    UPDATE network_health_snapshots
       SET subject_key = CONCAT(COALESCE(device_id, 0), ':', COALESCE(network_link_id, 0))
     WHERE subject_key IS NULL;

    ALTER TABLE network_health_snapshots
      ADD UNIQUE KEY uq_nhs_subject_date (subject_key, snapshot_date);
  END IF;
END //
DELIMITER ;

CALL migration_441_network_health_snapshot_key();
DROP PROCEDURE IF EXISTS migration_441_network_health_snapshot_key;
