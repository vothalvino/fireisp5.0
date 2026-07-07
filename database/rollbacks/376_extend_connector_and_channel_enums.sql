-- Rollback for migration 376 — narrow the enums back to their prior sets.
-- Rows holding the added values would be truncated on downgrade; best-effort.
DROP PROCEDURE IF EXISTS rollback_376_extend_enums;
DELIMITER //
CREATE PROCEDURE rollback_376_extend_enums()
BEGIN
  ALTER TABLE message_templates
    MODIFY COLUMN channel ENUM('email','sms','whatsapp','other') NOT NULL DEFAULT 'email';
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_connections') THEN
    ALTER TABLE integration_connections
      MODIFY COLUMN status ENUM('active','error','disabled','pending') NOT NULL DEFAULT 'pending';
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'router_driver_configs') THEN
    ALTER TABLE router_driver_configs
      MODIFY COLUMN last_test_status ENUM('ok','failed','pending') NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_command_executions') THEN
    ALTER TABLE device_command_executions
      MODIFY COLUMN status ENUM('queued','success','failure','stubbed') NOT NULL DEFAULT 'queued';
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remediation_executions') THEN
    ALTER TABLE remediation_executions
      MODIFY COLUMN status ENUM('queued','success','failure','stubbed') NOT NULL DEFAULT 'stubbed';
  END IF;
END //
DELIMITER ;
CALL rollback_376_extend_enums();
DROP PROCEDURE IF EXISTS rollback_376_extend_enums;
