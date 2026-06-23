-- =============================================================================
-- Migration 363 — Consolidate `jobs` into `work_orders`
-- =============================================================================
-- Retires the legacy `jobs` field-work table by folding it into `work_orders`,
-- which becomes the single field-work / dispatch table. work_orders gains:
--   • nullable target links: client_id, site_id, device_id, contract_id,
--     service_order_id  (a work order targets a subscriber, a POP/site, a
--     specific device, and/or relates to a contract / originating service order)
--   • work_type  — classifier migrated from jobs.type
--   • legacy_job_id — provenance of the original jobs.id (NULL for natively
--     created work orders); used for idempotent re-runs and a faithful rollback.
--
-- Existing jobs rows are migrated in; expenses.job_id and
-- inventory_transactions.job_id foreign keys are repointed from jobs ->
-- work_orders (the column names are kept for stability — both already mean
-- "the field work this row relates to"); then the jobs table is dropped.
--
-- Status enum differs (jobs.scheduled has no work_orders equivalent) -> mapped
-- scheduled => pending. priority/work_type enum literals are a subset and copy
-- straight across. jobs has no organization_id; work_orders requires it, so it
-- is backfilled from the client's organization (fallback: first organization).
--
-- Idempotent via INFORMATION_SCHEMA guards (re-runnable on MySQL 8).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend work_orders with target-link columns + work_type + provenance
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_363_extend_work_orders;
DELIMITER //
CREATE PROCEDURE migration_363_extend_work_orders()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'work_orders'
      AND COLUMN_NAME  = 'client_id'
  ) THEN
    ALTER TABLE work_orders
      ADD COLUMN client_id BIGINT UNSIGNED NULL
          COMMENT 'Subscriber this work order serves (NULL for internal/NOC work)'
          AFTER organization_id,
      ADD COLUMN site_id BIGINT UNSIGNED NULL
          COMMENT 'POP / site this work order targets'
          AFTER client_id,
      ADD COLUMN device_id BIGINT UNSIGNED NULL
          COMMENT 'Specific device this work order targets'
          AFTER site_id,
      ADD COLUMN contract_id BIGINT UNSIGNED NULL
          COMMENT 'Contract this work order relates to'
          AFTER device_id,
      ADD COLUMN service_order_id BIGINT UNSIGNED NULL
          COMMENT 'Originating service order, if spawned from provisioning'
          AFTER contract_id,
      ADD COLUMN work_type ENUM('installation','maintenance','repair','survey','other')
          NOT NULL DEFAULT 'other'
          COMMENT 'Field-work classification (migrated from jobs.type)'
          AFTER priority,
      ADD COLUMN legacy_job_id BIGINT UNSIGNED NULL
          COMMENT 'Original jobs.id this row was migrated from (migration 363); NULL for natively-created work orders'
          AFTER deleted_at;
  END IF;
END //
DELIMITER ;
CALL migration_363_extend_work_orders();
DROP PROCEDURE IF EXISTS migration_363_extend_work_orders;

-- ---------------------------------------------------------------------------
-- 2. Indexes + foreign keys for the new target columns (each idempotent)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_363_add_wo_keys;
DELIMITER //
CREATE PROCEDURE migration_363_add_wo_keys()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_client') THEN
    CREATE INDEX idx_wo_client ON work_orders (client_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_site') THEN
    CREATE INDEX idx_wo_site ON work_orders (site_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_device') THEN
    CREATE INDEX idx_wo_device ON work_orders (device_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_contract') THEN
    CREATE INDEX idx_wo_contract ON work_orders (contract_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_service_order') THEN
    CREATE INDEX idx_wo_service_order ON work_orders (service_order_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND INDEX_NAME='idx_wo_legacy_job') THEN
    CREATE INDEX idx_wo_legacy_job ON work_orders (legacy_job_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_client') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_site') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_site FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_device') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_contract') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_contract FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_service_order') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_service_order FOREIGN KEY (service_order_id) REFERENCES service_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_363_add_wo_keys();
DROP PROCEDURE IF EXISTS migration_363_add_wo_keys;

-- ---------------------------------------------------------------------------
-- 3. Migrate jobs -> work_orders, repoint expenses/inventory FKs, drop jobs
--    Guarded on the jobs table still existing, so re-runs are safe.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_363_migrate_and_drop_jobs;
DELIMITER //
CREATE PROCEDURE migration_363_migrate_and_drop_jobs()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'
  ) THEN
    -- work_orders.organization_id is NOT NULL, so every migrated row needs a
    -- resolvable organization. If there are jobs to migrate but no organization
    -- exists at all (a degenerate single-tenant install that never used work
    -- orders), skip the migration entirely rather than crash / lose data — the
    -- jobs table is left intact for manual handling. (Nested IF so the
    -- `SELECT FROM jobs` only runs while the table still exists, keeping re-runs
    -- safe after the table has been dropped.)
    IF (NOT EXISTS (SELECT 1 FROM jobs) OR EXISTS (SELECT 1 FROM organizations)) THEN
    -- 3a. Copy job rows into work_orders (skip any already migrated)
    INSERT INTO work_orders
      (organization_id, client_id, site_id, contract_id, ticket_id, assigned_to, created_by,
       title, description, status, priority, work_type, scheduled_at, completed_at, notes,
       legacy_job_id, created_at, updated_at)
    SELECT
      COALESCE(c.organization_id, (SELECT o.id FROM organizations o ORDER BY o.id LIMIT 1)),
      j.client_id, j.site_id, j.contract_id, j.ticket_id, j.assigned_to, j.created_by,
      j.title, j.description,
      CASE j.status WHEN 'scheduled' THEN 'pending' ELSE j.status END,
      j.priority, j.type, j.scheduled_date, j.completed_date, j.notes,
      j.id, j.created_at, j.updated_at
    FROM jobs j
    LEFT JOIN clients c ON c.id = j.client_id
    WHERE NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.legacy_job_id = j.id);

    -- 3b. Repoint expenses.job_id off jobs, remap values to the new work_order ids
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND CONSTRAINT_NAME='fk_expenses_job') THEN
      ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_job;
    END IF;
    UPDATE expenses e JOIN work_orders w ON w.legacy_job_id = e.job_id
      SET e.job_id = w.id
      WHERE e.job_id IS NOT NULL;

    -- 3c. Repoint inventory_transactions.job_id off jobs, remap values
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_transactions' AND CONSTRAINT_NAME='fk_inv_txn_job') THEN
      ALTER TABLE inventory_transactions DROP FOREIGN KEY fk_inv_txn_job;
    END IF;
    UPDATE inventory_transactions t JOIN work_orders w ON w.legacy_job_id = t.job_id
      SET t.job_id = w.id
      WHERE t.job_id IS NOT NULL;

    -- 3d. jobs is now unreferenced -> drop it
    DROP TABLE jobs;
    END IF;
  END IF;

  -- 3e. (Re)point the FKs at work_orders. Runs whether or not jobs existed, so a
  --     re-run after the table is gone still converges to the correct state.
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND CONSTRAINT_NAME='fk_expenses_job') THEN
    ALTER TABLE expenses ADD CONSTRAINT fk_expenses_job FOREIGN KEY (job_id) REFERENCES work_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_transactions' AND CONSTRAINT_NAME='fk_inv_txn_job') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT fk_inv_txn_job FOREIGN KEY (job_id) REFERENCES work_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_363_migrate_and_drop_jobs();
DROP PROCEDURE IF EXISTS migration_363_migrate_and_drop_jobs;
