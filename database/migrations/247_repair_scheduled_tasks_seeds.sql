-- =============================================================================
-- Migration: 247_repair_scheduled_tasks_seeds
-- =============================================================================
-- Description: Repairs damage left in scheduled_tasks by earlier global seed
--              migrations (100, 123, 138, 139, 145, 154, 155, 156, 158, 162,
--              164, 196, 198, 200, 201, 206, 208, 211, 223, 225, 233, 236,
--              240) on databases that already ran them.
--
--              Root cause: those seeds used INSERT IGNORE (or ON DUPLICATE
--              KEY UPDATE in 145) with organization_id = NULL, relying on
--              UNIQUE KEY uq_scheduled_tasks_org_name (organization_id,
--              task_name).  MySQL unique keys treat NULLs as distinct, so the
--              key never collides for global rows — re-running a seed after a
--              partial migration failure inserted duplicate task rows.
--              Additionally, INSERT IGNORE silently demotes invalid ENUM
--              values to '' (the ENUM error value, index 0):
--
--                * priority numeric 5 (out of range for
--                  ENUM('low','normal','high','critical')) was stored as ''
--                  for: alert_evaluation (138), retry_failed_charges (154),
--                  check_pool_utilization (236), scan_auth_failures (240).
--                * priority numeric 4 mapped by ENUM index to 'critical' for
--                  process_recurring_charges (139) — unintended; should be
--                  'high'.
--                * task_type 'maintenance' (not in the task_type ENUM) was
--                  stored as '' for: database_backup (156),
--                  config_backup_pull (158), quarterly_dr_drill (164) —
--                  intended existing value is 'backup'.
--                * task_type 'webhook_retry' (not in the task_type ENUM) was
--                  stored as '' for: webhook_retry (162) — closest existing
--                  value is 'other'.
--
--              The seed migrations themselves have been rewritten to the
--              INSERT ... SELECT ... WHERE NOT EXISTS pattern with valid ENUM
--              literals (fresh installs are clean); this migration repairs
--              databases where the defective versions already ran.
--
--              No ENUM extension is performed — all repaired values already
--              exist in migration 047's ENUM definitions.
--
--              Every statement below is individually idempotent and
--              re-runnable (the migration runner does not use transactions).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1 — Deduplicate global rows.
-- For rows with organization_id IS NULL sharing the same task_name, keep the
-- row with the lowest id and delete the rest.  A multi-table DELETE with a
-- self-join is valid in MySQL 8 and re-runnable (zero rows match once clean).
-- No other table carries a foreign key to scheduled_tasks.id, so deleting
-- duplicate rows is safe.
-- ---------------------------------------------------------------------------
DELETE st_dup
FROM scheduled_tasks AS st_dup
JOIN scheduled_tasks AS st_keep
  ON  st_keep.task_name = st_dup.task_name
  AND st_keep.id        < st_dup.id
WHERE st_dup.organization_id  IS NULL
  AND st_keep.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2a — Repair priority values demoted to '' (ENUM error value).
-- These four tasks were seeded with the out-of-range numeric literal 5 —
-- the intended priority is 'high'.
-- ---------------------------------------------------------------------------
UPDATE scheduled_tasks
SET    priority = 'high'
WHERE  organization_id IS NULL
  AND  priority = ''
  AND  task_name IN (
         'alert_evaluation',
         'retry_failed_charges',
         'check_pool_utilization',
         'scan_auth_failures'
       );

-- ---------------------------------------------------------------------------
-- Step 2b — Repair process_recurring_charges (migration 139).
-- It was seeded with the numeric literal 4, which the ENUM mapped by index to
-- 'critical'; the intended priority is 'high'.
-- ---------------------------------------------------------------------------
UPDATE scheduled_tasks
SET    priority = 'high'
WHERE  organization_id IS NULL
  AND  task_name = 'process_recurring_charges'
  AND  priority = 'critical';

-- ---------------------------------------------------------------------------
-- Step 2c — Repair task_type values demoted to '' (ENUM error value).
-- The backup-related tasks were seeded with the invalid value 'maintenance' —
-- the matching existing ENUM member is 'backup'.
-- ---------------------------------------------------------------------------
UPDATE scheduled_tasks
SET    task_type = 'backup'
WHERE  organization_id IS NULL
  AND  task_type = ''
  AND  task_name IN (
         'database_backup',
         'config_backup_pull',
         'quarterly_dr_drill'
       );

-- ---------------------------------------------------------------------------
-- Step 2d — Repair webhook_retry (migration 162).
-- It was seeded with the invalid task_type 'webhook_retry'; the closest
-- existing ENUM member is 'other'.
-- ---------------------------------------------------------------------------
UPDATE scheduled_tasks
SET    task_type = 'other'
WHERE  organization_id IS NULL
  AND  task_type = ''
  AND  task_name = 'webhook_retry';
