-- =============================================================================
-- Migration 380 — Simplified service-order flow
-- =============================================================================
-- Replaces the 5-state service-order workflow (requested → approved →
-- provisioning → activated, or cancelled) with a simplified 4-state flow:
--
--   new → in_process → done          (plus cancelled, reachable from new/in_process)
--
-- "Start" (new → in_process) now auto-creates + provisions the contract from
-- the order's plan (src/services/lifecycleService.js#startOrder), so the old
-- approve/provision split is no longer needed. "Complete" (in_process → done)
-- asks whether the installation is already paid or an invoice must be raised
-- (src/services/lifecycleService.js#completeOrder).
--
-- Data migration for existing rows:
--   requested, approved   -> new
--   provisioning          -> in_process   (started_at backfilled)
--   activated             -> done         (started_at + completed_at backfilled)
--   cancelled             -> cancelled    (unchanged)
--
-- approved_at/approved_by/activated_at are kept for historical/audit purposes
-- but are no longer written by the new flow.
--
-- Also widens clients.address to VARCHAR(500) to match leads.address and the
-- validation schemas (both clients.js and leads.js schemas already allow up
-- to 500 chars) — a lead converted to a client with a 256-500 char address
-- previously truncated/broke silently on lead -> client conversion.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_380_service_order_simplified_flow;
DELIMITER //
CREATE PROCEDURE migration_380_service_order_simplified_flow()
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. New timestamp columns for the simplified flow.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'started_at'
  ) THEN
    ALTER TABLE service_orders
      ADD COLUMN started_at DATETIME NULL
          COMMENT 'When the order moved to in_process (contract auto-created/provisioned) (migration 380)'
          AFTER activated_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'completed_at'
  ) THEN
    ALTER TABLE service_orders
      ADD COLUMN completed_at DATETIME NULL
          COMMENT 'When the order moved to done (installation invoiced or marked already paid) (migration 380)'
          AFTER started_at;
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. Status enum migration + data backfill. Guarded on whether the final
  --    ('new','in_process','done','cancelled') enum is already active, so a
  --    re-run is a no-op.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'status'
      AND COLUMN_TYPE  = "enum('new','in_process','done','cancelled')"
  ) THEN
    -- Widen to a superset enum so both old and new values are valid while data
    -- is remapped.
    ALTER TABLE service_orders
      MODIFY COLUMN status ENUM('requested','approved','provisioning','activated','cancelled','new','in_process','done')
          NOT NULL DEFAULT 'requested';

    -- Backfill started_at/completed_at from the historical timestamps before
    -- the status text itself is remapped. Only provisioning/activated rows
    -- actually reached "started" — an 'approved' row remaps to 'new' (not yet
    -- started), so it must NOT be included here or a not-yet-started order
    -- would carry a started_at timestamp.
    UPDATE service_orders
       SET started_at = COALESCE(approved_at, activated_at)
     WHERE status IN ('provisioning', 'activated')
       AND started_at IS NULL;

    UPDATE service_orders
       SET completed_at = activated_at
     WHERE status = 'activated'
       AND completed_at IS NULL;

    -- Remap statuses onto the simplified flow.
    UPDATE service_orders SET status = 'new' WHERE status IN ('requested', 'approved');
    UPDATE service_orders SET status = 'in_process' WHERE status = 'provisioning';
    UPDATE service_orders SET status = 'done' WHERE status = 'activated';

    -- Narrow to the final enum.
    ALTER TABLE service_orders
      MODIFY COLUMN status ENUM('new','in_process','done','cancelled')
          NOT NULL DEFAULT 'new';
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Widen clients.address to match leads.address / validation schemas.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'address'
      AND CHARACTER_MAXIMUM_LENGTH < 500
  ) THEN
    ALTER TABLE clients
      MODIFY COLUMN address VARCHAR(500) NULL;
  END IF;
END //
DELIMITER ;
CALL migration_380_service_order_simplified_flow();
DROP PROCEDURE IF EXISTS migration_380_service_order_simplified_flow;

-- -----------------------------------------------------------------------------
-- 4. Grant plans.view to the support role.
-- -----------------------------------------------------------------------------
-- support already has service_orders.create (migration 194) and now creates
-- orders through a real plan picker (frontend, this PR) instead of typing a
-- raw plan_id — without plans.view the picker's GET /plans call 403s, the
-- dropdown renders silently empty, and support creates a plan-less order that
-- can never be started (startOrder requires plan_id). INSERT IGNORE is
-- idempotent via role_permissions' uq_role_permissions(role_id, permission_id)
-- unique key — safe to re-run. Mirrors the exact pattern used by migrations
-- 119/194.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name = 'plans.view'
WHERE  r.name = 'support';
