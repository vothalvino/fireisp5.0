-- =============================================================================
-- Migration 260: §6.5 Alerting & Notification — Core Tables
-- =============================================================================
-- Creates 5 new tables and extends alert_rules / alert_events with new columns.
-- All guarded with INFORMATION_SCHEMA checks via stored procedures.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. alert_escalation_chains
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_chains (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  deleted_at       DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_aec_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_aec_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. alert_escalation_steps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_steps (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chain_id              BIGINT UNSIGNED NOT NULL,
  step_number           TINYINT UNSIGNED NOT NULL COMMENT 'Order: 1=L1, 2=L2, 3=L3',
  delay_minutes         INT UNSIGNED NOT NULL DEFAULT 15,
  notification_channel  ENUM('email','sms','whatsapp','telegram','webhook') NOT NULL DEFAULT 'email',
  recipient_email       VARCHAR(255) NULL,
  recipient_phone       VARCHAR(50) NULL,
  webhook_url           VARCHAR(512) NULL,
  message_template      TEXT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_aes_chain FOREIGN KEY (chain_id) REFERENCES alert_escalation_chains(id) ON DELETE CASCADE,
  INDEX idx_aes_chain (chain_id),
  UNIQUE KEY uq_escalation_step (chain_id, step_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. maintenance_windows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id             BIGINT UNSIGNED NULL,
  name                        VARCHAR(255) NOT NULL,
  description                 TEXT NULL,
  device_id                   BIGINT UNSIGNED NULL,
  site_id                     BIGINT UNSIGNED NULL,
  starts_at                   DATETIME NOT NULL,
  ends_at                     DATETIME NOT NULL,
  is_recurring                TINYINT(1) NOT NULL DEFAULT 0,
  recurrence_cron             VARCHAR(50) NULL,
  recurrence_duration_minutes INT UNSIGNED NULL,
  status                      ENUM('scheduled','active','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_by                  BIGINT UNSIGNED NULL,
  deleted_at                  DATETIME NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_mw_org     FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_mw_device  FOREIGN KEY (device_id)       REFERENCES devices(id)       ON DELETE SET NULL,
  CONSTRAINT fk_mw_site    FOREIGN KEY (site_id)         REFERENCES sites(id)         ON DELETE SET NULL,
  CONSTRAINT fk_mw_user    FOREIGN KEY (created_by)      REFERENCES users(id)         ON DELETE SET NULL,
  INDEX idx_mw_org (organization_id),
  INDEX idx_maintenance_windows_times (organization_id, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. alert_notification_channels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_notification_channels (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(255) NOT NULL,
  channel_type     ENUM('email','sms','whatsapp','telegram','webhook') NOT NULL,
  config_encrypted TEXT NULL COMMENT 'JSON with channel-specific settings, AES-256 encrypted',
  is_enabled       TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at       DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_anc_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_anc_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. alert_suppression_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_suppression_rules (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id          BIGINT UNSIGNED NULL,
  name                     VARCHAR(255) NOT NULL,
  upstream_device_id       BIGINT UNSIGNED NULL,
  downstream_device_id     BIGINT UNSIGNED NULL,
  suppress_duration_minutes INT UNSIGNED NOT NULL DEFAULT 60,
  is_enabled               TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at               DATETIME NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_asr_org        FOREIGN KEY (organization_id)      REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_asr_upstream   FOREIGN KEY (upstream_device_id)   REFERENCES devices(id)       ON DELETE SET NULL,
  CONSTRAINT fk_asr_downstream FOREIGN KEY (downstream_device_id) REFERENCES devices(id)       ON DELETE SET NULL,
  INDEX idx_asr_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. ALTER alert_rules — add new columns (INFORMATION_SCHEMA-guarded)
-- ---------------------------------------------------------------------------
DELIMITER $$
CREATE PROCEDURE migration_260_alter_alert_rules()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'escalation_chain_id') THEN
    ALTER TABLE alert_rules ADD COLUMN escalation_chain_id BIGINT UNSIGNED NULL AFTER notification_channels;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND CONSTRAINT_NAME = 'fk_alert_rules_escalation_chain') THEN
    ALTER TABLE alert_rules ADD CONSTRAINT fk_alert_rules_escalation_chain FOREIGN KEY (escalation_chain_id) REFERENCES alert_escalation_chains(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_detection_enabled') THEN
    ALTER TABLE alert_rules ADD COLUMN flap_detection_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER escalation_chain_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_count_threshold') THEN
    ALTER TABLE alert_rules ADD COLUMN flap_count_threshold TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER flap_detection_enabled;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'flap_window_minutes') THEN
    ALTER TABLE alert_rules ADD COLUMN flap_window_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15 AFTER flap_count_threshold;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_enabled') THEN
    ALTER TABLE alert_rules ADD COLUMN baseline_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER flap_window_minutes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_lookback_hours') THEN
    ALTER TABLE alert_rules ADD COLUMN baseline_lookback_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24 AFTER baseline_enabled;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_rules' AND COLUMN_NAME = 'baseline_stddev_multiplier') THEN
    ALTER TABLE alert_rules ADD COLUMN baseline_stddev_multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.00 AFTER baseline_lookback_hours;
  END IF;
END$$
DELIMITER ;
CALL migration_260_alter_alert_rules();
DROP PROCEDURE IF EXISTS migration_260_alter_alert_rules;

-- ---------------------------------------------------------------------------
-- 7. ALTER alert_events — add new columns (INFORMATION_SCHEMA-guarded)
-- ---------------------------------------------------------------------------
DELIMITER $$
CREATE PROCEDURE migration_260_alter_alert_events()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'escalation_step') THEN
    ALTER TABLE alert_events ADD COLUMN escalation_step INT UNSIGNED NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'escalated_at') THEN
    ALTER TABLE alert_events ADD COLUMN escalated_at DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'flapping') THEN
    ALTER TABLE alert_events ADD COLUMN flapping TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'suppressed') THEN
    ALTER TABLE alert_events ADD COLUMN suppressed TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_events' AND COLUMN_NAME = 'maintenance_window_id') THEN
    ALTER TABLE alert_events ADD COLUMN maintenance_window_id BIGINT UNSIGNED NULL;
  END IF;
END$$
DELIMITER ;
CALL migration_260_alter_alert_events();
DROP PROCEDURE IF EXISTS migration_260_alter_alert_events;
