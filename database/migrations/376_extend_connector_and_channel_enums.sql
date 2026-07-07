-- =============================================================================
-- Migration 376 — Extend enums so honest stub/channel writes stop failing
-- =============================================================================
-- Live testing found five ENUMs too narrow for values the code legitimately
-- writes, so the INSERT/UPDATE threw "Data truncated for column":
--
--   * message_templates.channel — the UI + route offer a 'push' channel
--     (web-push is a supported delivery method) but the enum omitted it.
--   * integration_connections.status — connector test/sync are STUBBED and
--     record 'not_implemented' (the stub-honesty contract, tests/stubHonesty.test.js).
--   * router_driver_configs.last_test_status — a non-MikroTik driver test is a
--     stub and records 'not_implemented'.
--   * device_command_executions.status — a non-MikroTik command dispatch records
--     'not_dispatched' (never faked as success).
--   * remediation_executions.status — a stubbed device remediation records
--     'not_dispatched'.
--
-- The 'not_implemented'/'not_dispatched' values are deliberately DISTINCT from
-- the generic 'stubbed' (see tests/stubHonesty.test.js, which asserts the
-- distinction), so the honest status is added to each enum rather than reusing
-- 'stubbed'. A separate service fix writes the already-valid 'ai_escalated'
-- ticket source for AI-support escalations (no schema change needed there).
-- Each MODIFY is guarded so re-running is a no-op on MySQL 8.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_376_extend_enums;
DELIMITER //
CREATE PROCEDURE migration_376_extend_enums()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'message_templates' AND COLUMN_NAME = 'channel' AND COLUMN_TYPE LIKE '%''push''%') THEN
    ALTER TABLE message_templates
      MODIFY COLUMN channel ENUM('email','sms','whatsapp','push','other') NOT NULL DEFAULT 'email';
  END IF;

  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_connections')
     AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'integration_connections' AND COLUMN_NAME = 'status' AND COLUMN_TYPE LIKE '%''not_implemented''%') THEN
    ALTER TABLE integration_connections
      MODIFY COLUMN status ENUM('active','error','disabled','pending','not_implemented') NOT NULL DEFAULT 'pending';
  END IF;

  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'router_driver_configs')
     AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'router_driver_configs' AND COLUMN_NAME = 'last_test_status' AND COLUMN_TYPE LIKE '%''not_implemented''%') THEN
    ALTER TABLE router_driver_configs
      MODIFY COLUMN last_test_status ENUM('ok','failed','pending','not_implemented') NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_command_executions')
     AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'device_command_executions' AND COLUMN_NAME = 'status' AND COLUMN_TYPE LIKE '%''not_dispatched''%') THEN
    ALTER TABLE device_command_executions
      MODIFY COLUMN status ENUM('queued','success','failure','stubbed','not_dispatched') NOT NULL DEFAULT 'queued';
  END IF;

  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remediation_executions')
     AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'remediation_executions' AND COLUMN_NAME = 'status' AND COLUMN_TYPE LIKE '%''not_dispatched''%') THEN
    ALTER TABLE remediation_executions
      MODIFY COLUMN status ENUM('queued','success','failure','stubbed','not_dispatched') NOT NULL DEFAULT 'stubbed';
  END IF;
END //
DELIMITER ;
CALL migration_376_extend_enums();
DROP PROCEDURE IF EXISTS migration_376_extend_enums;
