-- =============================================================================
-- Migration 235: ip_pools PPPoE Enhancements (Phase A)
-- =============================================================================
-- Implements isp-platform-features.md §4.1 "PPPoE Management Phase A":
--   Extends the ip_pools table with fields needed for NAS-pool binding,
--   service type classification, IPv6 prefix delegation, range exclusions,
--   and utilization threshold alerting.
--
-- Columns added (all via stored-procedure IF NOT EXISTS guards):
--   nas_id               BIGINT UNSIGNED NULL
--                          — FK → nas(id) ON DELETE SET NULL ON UPDATE CASCADE;
--                            identifies which NAS serves this pool.
--   service_type         ENUM('residential','business','corporate','government','mixed') NULL DEFAULT 'mixed'
--                          — Subscriber class this pool is intended for.
--   default_prefix_len   TINYINT UNSIGNED NULL
--                          — IPv6 prefix delegation length (e.g. 48, 56, 64);
--                            NULL for IPv4 pools or when PD is not used.
--   excluded_ranges      TEXT NULL
--                          — Comma- or newline-separated ranges to skip during
--                            dynamic allocation (e.g. management IPs).
--   last_alerted_threshold TINYINT UNSIGNED NULL
--                          — Last utilization percentage that triggered an alert
--                            (75 or 90); reset to NULL when usage drops below 75%.
--
-- FK constraints added (guarded via INFORMATION_SCHEMA.KEY_COLUMN_USAGE checks):
--   fk_ip_pools_nas — ip_pools.nas_id → nas(id) ON DELETE SET NULL ON UPDATE CASCADE
--
-- Indexes added (guarded via INFORMATION_SCHEMA.STATISTICS checks):
--   idx_ip_pools_nas_id on ip_pools(nas_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Column: nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_nas_id;
DELIMITER //
CREATE PROCEDURE migration_235_add_ip_pools_nas_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'nas_id'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN nas_id BIGINT UNSIGNED NULL
        COMMENT 'NAS device serving this pool; NULL = not tied to a specific NAS'
        AFTER site_id;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_ip_pools_nas_id();
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_nas_id;

-- ---------------------------------------------------------------------------
-- Index: idx_ip_pools_nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_idx_ip_pools_nas_id;
DELIMITER //
CREATE PROCEDURE migration_235_add_idx_ip_pools_nas_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND INDEX_NAME   = 'idx_ip_pools_nas_id'
  ) THEN
    ALTER TABLE ip_pools ADD INDEX idx_ip_pools_nas_id (nas_id);
  END IF;
END //
DELIMITER ;
CALL migration_235_add_idx_ip_pools_nas_id();
DROP PROCEDURE IF EXISTS migration_235_add_idx_ip_pools_nas_id;

-- ---------------------------------------------------------------------------
-- FK: fk_ip_pools_nas — ip_pools.nas_id → nas(id) ON DELETE SET NULL ON UPDATE CASCADE
-- Guarded via INFORMATION_SCHEMA.KEY_COLUMN_USAGE.
-- NOTE: Column is NULL + FK is SET NULL — no NOT NULL + SET NULL violation.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_fk_ip_pools_nas;
DELIMITER //
CREATE PROCEDURE migration_235_add_fk_ip_pools_nas()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA        = DATABASE()
      AND TABLE_NAME          = 'ip_pools'
      AND CONSTRAINT_NAME     = 'fk_ip_pools_nas'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE ip_pools
      ADD CONSTRAINT fk_ip_pools_nas
        FOREIGN KEY (nas_id) REFERENCES nas (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_fk_ip_pools_nas();
DROP PROCEDURE IF EXISTS migration_235_add_fk_ip_pools_nas;

-- ---------------------------------------------------------------------------
-- Column: service_type
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_service_type;
DELIMITER //
CREATE PROCEDURE migration_235_add_ip_pools_service_type()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'service_type'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN service_type ENUM('residential','business','corporate','government','mixed') NULL DEFAULT 'mixed'
        COMMENT 'Subscriber class this pool is intended to serve'
        AFTER nas_id;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_ip_pools_service_type();
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_service_type;

-- ---------------------------------------------------------------------------
-- Column: default_prefix_len
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_default_prefix_len;
DELIMITER //
CREATE PROCEDURE migration_235_add_ip_pools_default_prefix_len()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'default_prefix_len'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN default_prefix_len TINYINT UNSIGNED NULL
        COMMENT 'IPv6 prefix delegation length assigned to subscribers (e.g. 48, 56, 64); NULL for IPv4 pools or when PD is unused'
        AFTER service_type;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_ip_pools_default_prefix_len();
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_default_prefix_len;

-- ---------------------------------------------------------------------------
-- Column: excluded_ranges
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_excluded_ranges;
DELIMITER //
CREATE PROCEDURE migration_235_add_ip_pools_excluded_ranges()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'excluded_ranges'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN excluded_ranges TEXT NULL
        COMMENT 'Comma- or newline-separated IP ranges to skip during dynamic allocation (e.g. management addresses)'
        AFTER default_prefix_len;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_ip_pools_excluded_ranges();
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_excluded_ranges;

-- ---------------------------------------------------------------------------
-- Column: last_alerted_threshold
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_last_alerted_threshold;
DELIMITER //
CREATE PROCEDURE migration_235_add_ip_pools_last_alerted_threshold()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'last_alerted_threshold'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN last_alerted_threshold TINYINT UNSIGNED NULL
        COMMENT 'Last utilization % threshold that fired an alert (75 or 90); reset to NULL when usage drops below 75%'
        AFTER excluded_ranges;
  END IF;
END //
DELIMITER ;
CALL migration_235_add_ip_pools_last_alerted_threshold();
DROP PROCEDURE IF EXISTS migration_235_add_ip_pools_last_alerted_threshold;
