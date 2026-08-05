-- Rollback for migration 448 — install test window
DELETE FROM scheduled_tasks WHERE task_name = 'test_window_expiry';
ALTER TABLE contracts
  DROP COLUMN test_window_expires_at;
