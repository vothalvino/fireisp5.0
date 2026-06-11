-- =============================================================================
-- Migration 200: Plan billing features — RADIUS vendor mapping, FUP throttling,
--                overage billing, free trial, and plan_throttle_logs table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Add new columns to plans table using stored-procedure guards (MySQL compat)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_200_plan_billing_features;
DELIMITER //
CREATE PROCEDURE migration_200_plan_billing_features()
BEGIN
  -- radius_vendor
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'radius_vendor'
  ) THEN
    ALTER TABLE plans ADD COLUMN radius_vendor ENUM('mikrotik','cisco','juniper') NULL DEFAULT NULL AFTER burst_upload_mbps;
  END IF;

  -- radius_rate_limit_template
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'radius_rate_limit_template'
  ) THEN
    ALTER TABLE plans ADD COLUMN radius_rate_limit_template VARCHAR(200) NULL AFTER radius_vendor;
  END IF;

  -- fup_threshold_gb
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'fup_threshold_gb'
  ) THEN
    ALTER TABLE plans ADD COLUMN fup_threshold_gb DECIMAL(10,2) NULL COMMENT 'GB at which FUP kicks in; NULL = same as data_cap_gb' AFTER radius_rate_limit_template;
  END IF;

  -- fup_threshold_percent
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'fup_threshold_percent'
  ) THEN
    ALTER TABLE plans ADD COLUMN fup_threshold_percent TINYINT UNSIGNED NULL COMMENT 'Percent of cap at which FUP kicks in' AFTER fup_threshold_gb;
  END IF;

  -- fup_download_speed_mbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'fup_download_speed_mbps'
  ) THEN
    ALTER TABLE plans ADD COLUMN fup_download_speed_mbps INT UNSIGNED NULL COMMENT 'Throttled download speed after FUP' AFTER fup_threshold_percent;
  END IF;

  -- fup_upload_speed_mbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'fup_upload_speed_mbps'
  ) THEN
    ALTER TABLE plans ADD COLUMN fup_upload_speed_mbps INT UNSIGNED NULL COMMENT 'Throttled upload speed after FUP' AFTER fup_download_speed_mbps;
  END IF;

  -- overage_mode
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'overage_mode'
  ) THEN
    ALTER TABLE plans ADD COLUMN overage_mode ENUM('none','per_gb','upgrade_prompt') NOT NULL DEFAULT 'none' AFTER fup_upload_speed_mbps;
  END IF;

  -- overage_price_per_gb
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'overage_price_per_gb'
  ) THEN
    ALTER TABLE plans ADD COLUMN overage_price_per_gb DECIMAL(10,4) NULL AFTER overage_mode;
  END IF;

  -- trial_days
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'trial_days'
  ) THEN
    ALTER TABLE plans ADD COLUMN trial_days INT UNSIGNED NULL COMMENT 'Number of free trial days; NULL = no trial' AFTER overage_price_per_gb;
  END IF;

  -- trial_price
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'trial_price'
  ) THEN
    ALTER TABLE plans ADD COLUMN trial_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER trial_days;
  END IF;
END //
DELIMITER ;
CALL migration_200_plan_billing_features();
DROP PROCEDURE IF EXISTS migration_200_plan_billing_features;

-- ---------------------------------------------------------------------------
-- Table: plan_throttle_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_throttle_logs (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    contract_id   BIGINT UNSIGNED NOT NULL,
    action        ENUM('throttle','restore') NOT NULL,
    reason        ENUM('fup','overage','manual') NOT NULL DEFAULT 'fup',
    throttle_download_mbps INT UNSIGNED NULL,
    throttle_upload_mbps   INT UNSIGNED NULL,
    coa_sent      TINYINT(1) NOT NULL DEFAULT 0,
    coa_response  VARCHAR(200) NULL,
    notes         TEXT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_plan_throttle_logs_contract_id (contract_id),
    KEY idx_plan_throttle_logs_organization_id (organization_id),
    KEY idx_plan_throttle_logs_created_at (created_at),
    CONSTRAINT fk_plan_throttle_logs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheduled tasks
--
-- Idempotency note: INSERT ... SELECT ... WHERE NOT EXISTS — the UNIQUE KEY
-- on (organization_id, task_name) never collides when organization_id is
-- NULL, so INSERT IGNORE would duplicate rows on re-run.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT NULL, 'check_fup_thresholds', 'Apply FUP throttling to contracts that have exceeded their fair-use policy threshold', '*/15 * * * *', TRUE, 'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'check_fup_thresholds' AND organization_id IS NULL
);

INSERT INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT NULL, 'convert_expired_trials', 'Convert expired free-trial contracts to paid billing and notify the client', '0 * * * *', TRUE, 'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'convert_expired_trials' AND organization_id IS NULL
);
