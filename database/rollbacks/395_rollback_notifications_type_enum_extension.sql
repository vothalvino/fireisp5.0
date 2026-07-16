-- =============================================================================
-- Rollback 395 — Shrink notifications.type back to the original ENUM
-- =============================================================================
-- Re-map rows using the new values first so the MODIFY cannot truncate data.

UPDATE notifications SET type = 'info' WHERE type IN ('work_order', 'maintenance');

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('info','warning','error','billing','network','ticket')
    NOT NULL DEFAULT 'info';
