-- Rollback for migration 260: §6.5 Alerting & Notification — Core Tables

-- ---------------------------------------------------------------------------
-- Drop new alert_events columns
-- ---------------------------------------------------------------------------
DELIMITER $$
CREATE PROCEDURE _rollback_260_alert_events()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'maintenance_window_id') THEN
    ALTER TABLE alert_events DROP COLUMN maintenance_window_id;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'suppressed') THEN
    ALTER TABLE alert_events DROP COLUMN suppressed;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'flapping') THEN
    ALTER TABLE alert_events DROP COLUMN flapping;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'escalated_at') THEN
    ALTER TABLE alert_events DROP COLUMN escalated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'escalation_step') THEN
    ALTER TABLE alert_events DROP COLUMN escalation_step;
  END IF;
END$$
DELIMITER ;
CALL _rollback_260_alert_events();
DROP PROCEDURE IF EXISTS _rollback_260_alert_events;

-- ---------------------------------------------------------------------------
-- Drop new alert_rules columns and FK
-- ---------------------------------------------------------------------------
DELIMITER $$
CREATE PROCEDURE _rollback_260_alert_rules()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND CONSTRAINT_NAME = 'fk_alert_rules_escalation_chain') THEN
    ALTER TABLE alert_rules DROP FOREIGN KEY fk_alert_rules_escalation_chain;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'auto_create_ticket') THEN
    ALTER TABLE alert_rules DROP COLUMN auto_create_ticket;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_stddev_multiplier') THEN
    ALTER TABLE alert_rules DROP COLUMN baseline_stddev_multiplier;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_lookback_hours') THEN
    ALTER TABLE alert_rules DROP COLUMN baseline_lookback_hours;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_enabled') THEN
    ALTER TABLE alert_rules DROP COLUMN baseline_enabled;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_window_minutes') THEN
    ALTER TABLE alert_rules DROP COLUMN flap_window_minutes;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_count_threshold') THEN
    ALTER TABLE alert_rules DROP COLUMN flap_count_threshold;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_detection_enabled') THEN
    ALTER TABLE alert_rules DROP COLUMN flap_detection_enabled;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'escalation_chain_id') THEN
    ALTER TABLE alert_rules DROP COLUMN escalation_chain_id;
  END IF;
END$$
DELIMITER ;
CALL _rollback_260_alert_rules();
DROP PROCEDURE IF EXISTS _rollback_260_alert_rules;

-- ---------------------------------------------------------------------------
-- Drop new tables (reverse dependency order)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS alert_suppression_rules;
DROP TABLE IF EXISTS alert_notification_channels;
DROP TABLE IF EXISTS maintenance_windows;
DROP TABLE IF EXISTS alert_escalation_steps;
DROP TABLE IF EXISTS alert_escalation_chains;
