-- Rollback 290: FUP data rollover, data packs, and usage notifications
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM scheduled_tasks WHERE task_name IN ('fup_threshold_notify', 'rollover_balance_accrue') AND organization_id IS NULL;
DROP TABLE IF EXISTS fup_usage_notifications;
DROP TABLE IF EXISTS data_pack_purchases;
DROP TABLE IF EXISTS data_packs;
DROP TABLE IF EXISTS data_rollover_balances;
SET FOREIGN_KEY_CHECKS=1;
