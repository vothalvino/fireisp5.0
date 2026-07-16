-- =============================================================================
-- Rollback 396 — Shrink notifications.type back, dropping alert/outage/device
-- =============================================================================
-- Re-map rows using the new values first so the MODIFY cannot truncate data.

UPDATE notifications SET type = 'info' WHERE type IN ('alert', 'outage', 'device');

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('info','warning','error','billing','network','ticket','work_order','maintenance')
    NOT NULL DEFAULT 'info';
