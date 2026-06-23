-- Rollback 363 — restore the `jobs` table and revert the work_orders consolidation.
-- Recreates jobs, restores migrated rows from work_orders (by legacy_job_id),
-- repoints expenses/inventory_transactions FKs back to jobs (remapping values),
-- removes the migrated rows from work_orders, then drops the added columns/FKs.
-- Idempotent via INFORMATION_SCHEMA guards.

DROP PROCEDURE IF EXISTS rollback_363_restore_jobs;
DELIMITER //
CREATE PROCEDURE rollback_363_restore_jobs()
BEGIN
  -- 1. Recreate the jobs table (original DDL) and restore migrated rows
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'
  ) THEN
    CREATE TABLE jobs (
        id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        client_id      BIGINT UNSIGNED NOT NULL,
        site_id        BIGINT UNSIGNED NULL,
        contract_id    BIGINT UNSIGNED NULL,
        ticket_id      BIGINT UNSIGNED NULL,
        assigned_to    BIGINT UNSIGNED NULL,
        title          VARCHAR(255)    NOT NULL,
        description    TEXT            NULL,
        type           ENUM('installation', 'maintenance', 'repair', 'survey', 'other') NOT NULL DEFAULT 'other',
        priority       ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
        status         ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
        scheduled_date DATETIME        NULL,
        completed_date DATETIME        NULL,
        notes          TEXT            NULL,
        created_by     BIGINT UNSIGNED NULL,
        created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_jobs_client_id (client_id),
        KEY idx_jobs_site_id (site_id),
        KEY idx_jobs_contract_id (contract_id),
        KEY idx_jobs_ticket_id (ticket_id),
        KEY idx_jobs_assigned_to (assigned_to),
        KEY idx_jobs_status (status),
        KEY idx_jobs_scheduled_date (scheduled_date),
        CONSTRAINT fk_jobs_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_jobs_site FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_jobs_contract FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_jobs_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_jobs_assigned_to FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_jobs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    INSERT INTO jobs
      (id, client_id, site_id, contract_id, ticket_id, assigned_to, title, description,
       type, priority, status, scheduled_date, completed_date, notes, created_by, created_at, updated_at)
    SELECT
      w.legacy_job_id, w.client_id, w.site_id, w.contract_id, w.ticket_id, w.assigned_to,
      w.title, w.description, w.work_type,
      -- jobs.priority has no 'critical' value; clamp it to 'high' on the way back.
      CASE w.priority WHEN 'critical' THEN 'high' ELSE w.priority END,
      -- jobs has no 'assigned'/'pending'; map both back to a jobs status that
      -- round-trips cleanly under a re-applied forward migration.
      CASE w.status WHEN 'pending' THEN 'scheduled' WHEN 'assigned' THEN 'in_progress' ELSE w.status END,
      w.scheduled_at, w.completed_at, w.notes, w.created_by, w.created_at, w.updated_at
    FROM work_orders w
    WHERE w.legacy_job_id IS NOT NULL AND w.client_id IS NOT NULL;
  END IF;

  -- 2. Repoint expenses.job_id back to jobs (remap work_order ids -> original job ids)
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND CONSTRAINT_NAME='fk_expenses_job') THEN
    ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_job;
  END IF;
  -- Null out references to work orders that have NO restored job (natively
  -- created post-migration, or migrated rows whose client_id was cleared and so
  -- were not restored above) — otherwise repointing the FK at jobs would fail.
  UPDATE expenses e JOIN work_orders w ON w.id = e.job_id
    SET e.job_id = NULL
    WHERE NOT (w.legacy_job_id IS NOT NULL AND w.client_id IS NOT NULL);
  -- Remap references to restored jobs back to their original job ids.
  UPDATE expenses e JOIN work_orders w ON w.id = e.job_id
    SET e.job_id = w.legacy_job_id
    WHERE w.legacy_job_id IS NOT NULL AND w.client_id IS NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND CONSTRAINT_NAME='fk_expenses_job') THEN
    ALTER TABLE expenses ADD CONSTRAINT fk_expenses_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- 3. Repoint inventory_transactions.job_id back to jobs
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_transactions' AND CONSTRAINT_NAME='fk_inv_txn_job') THEN
    ALTER TABLE inventory_transactions DROP FOREIGN KEY fk_inv_txn_job;
  END IF;
  UPDATE inventory_transactions t JOIN work_orders w ON w.id = t.job_id
    SET t.job_id = NULL
    WHERE NOT (w.legacy_job_id IS NOT NULL AND w.client_id IS NOT NULL);
  UPDATE inventory_transactions t JOIN work_orders w ON w.id = t.job_id
    SET t.job_id = w.legacy_job_id
    WHERE w.legacy_job_id IS NOT NULL AND w.client_id IS NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_transactions' AND CONSTRAINT_NAME='fk_inv_txn_job') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT fk_inv_txn_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- 4. Remove the migrated rows that were restored to jobs (mirror the INSERT
  --    filter exactly, so rows that could NOT be restored stay as work orders
  --    rather than being silently lost).
  DELETE FROM work_orders WHERE legacy_job_id IS NOT NULL AND client_id IS NOT NULL;

  -- 5. Drop the foreign keys added to work_orders, then the columns
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_client') THEN
    ALTER TABLE work_orders DROP FOREIGN KEY fk_work_orders_client;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_site') THEN
    ALTER TABLE work_orders DROP FOREIGN KEY fk_work_orders_site;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_device') THEN
    ALTER TABLE work_orders DROP FOREIGN KEY fk_work_orders_device;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_contract') THEN
    ALTER TABLE work_orders DROP FOREIGN KEY fk_work_orders_contract;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND CONSTRAINT_NAME='fk_work_orders_service_order') THEN
    ALTER TABLE work_orders DROP FOREIGN KEY fk_work_orders_service_order;
  END IF;

  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND COLUMN_NAME='client_id') THEN
    ALTER TABLE work_orders
      DROP COLUMN client_id,
      DROP COLUMN site_id,
      DROP COLUMN device_id,
      DROP COLUMN contract_id,
      DROP COLUMN service_order_id,
      DROP COLUMN work_type,
      DROP COLUMN legacy_job_id;
  END IF;
END //
DELIMITER ;
CALL rollback_363_restore_jobs();
DROP PROCEDURE IF EXISTS rollback_363_restore_jobs;
