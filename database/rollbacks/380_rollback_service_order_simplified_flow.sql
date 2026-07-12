-- =============================================================================
-- Rollback 380 — Simplified service-order flow
-- =============================================================================
-- Reverses the status remap (new -> requested, in_process -> provisioning,
-- done -> activated; cancelled unchanged), drops started_at/completed_at, and
-- restores clients.address to VARCHAR(255). Best-effort: a "new" row cannot be
-- told apart from an original "requested" vs "approved" row, so it always maps
-- back to "requested"; any clients.address values beyond 255 chars written
-- after migration 380 will be truncated on downgrade.
-- INFORMATION_SCHEMA-guarded so a re-run or a rollback of a partially applied
-- 380 completes instead of aborting on the first already-reverted object.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_380_service_order_simplified_flow;
DELIMITER //
CREATE PROCEDURE rollback_380_service_order_simplified_flow()
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Status enum: remap back to the original 5-value set. Matches BOTH the
  --    final 4-value enum AND the 8-value superset a rollback of a PARTIALLY
  --    applied 380 would find mid-flight (forward migration widened the enum
  --    but crashed before narrowing it back down) — matching only the final
  --    4-value type would silently skip this whole block (including the data
  --    remap) while step 2 below still dropped started_at/completed_at,
  --    leaving a half-reverted schema with the wrong enum AND lost timestamps.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'status'
      AND COLUMN_TYPE IN (
        "enum('new','in_process','done','cancelled')",
        "enum('requested','approved','provisioning','activated','cancelled','new','in_process','done')"
      )
  ) THEN
    -- Widen to the superset enum (a no-op if already there from a partially
    -- applied forward migration) so both old and new values are valid while
    -- data is remapped.
    ALTER TABLE service_orders
      MODIFY COLUMN status ENUM('requested','approved','provisioning','activated','cancelled','new','in_process','done')
          NOT NULL DEFAULT 'new';

    UPDATE service_orders SET status = 'requested' WHERE status = 'new';
    UPDATE service_orders SET status = 'provisioning' WHERE status = 'in_process';
    UPDATE service_orders SET status = 'activated' WHERE status = 'done';

    -- Restore activated_at/approved_at from the migration-380 columns before
    -- they are dropped below, for rows the FORWARD migration itself proved
    -- equivalent (see 380_service_order_simplified_flow.sql's backfill):
    -- best-effort so downgrading doesn't destroy completion timestamps that
    -- were only ever copied FROM these same columns in the first place.
    UPDATE service_orders
       SET activated_at = COALESCE(activated_at, completed_at)
     WHERE status = 'activated'
       AND activated_at IS NULL;

    UPDATE service_orders
       SET approved_at = COALESCE(approved_at, started_at)
     WHERE status IN ('provisioning', 'activated')
       AND approved_at IS NULL;

    ALTER TABLE service_orders
      MODIFY COLUMN status ENUM('requested','approved','provisioning','activated','cancelled')
          NOT NULL DEFAULT 'requested';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. Drop the started_at/completed_at columns.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'completed_at'
  ) THEN
    ALTER TABLE service_orders DROP COLUMN completed_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'started_at'
  ) THEN
    ALTER TABLE service_orders DROP COLUMN started_at;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Restore clients.address to VARCHAR(255). Truncate first — under
  --    STRICT_TRANS_TABLES (the default since MySQL 5.7), a bare MODIFY that
  --    would silently truncate data instead ABORTS the statement, stranding
  --    the schema mid-rollback (this column would stay VARCHAR(500) while
  --    everything else in this procedure already reverted).
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'address'
      AND CHARACTER_MAXIMUM_LENGTH > 255
  ) THEN
    UPDATE clients SET address = LEFT(address, 255) WHERE CHAR_LENGTH(address) > 255;

    ALTER TABLE clients
      MODIFY COLUMN address VARCHAR(255) NULL;
  END IF;
END //
DELIMITER ;
CALL rollback_380_service_order_simplified_flow();
DROP PROCEDURE IF EXISTS rollback_380_service_order_simplified_flow;
