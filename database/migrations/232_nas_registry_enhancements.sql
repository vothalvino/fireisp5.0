-- =============================================================================
-- Migration 232: NAS Registry Enhancements (RADIUS Phase C)
-- =============================================================================
-- Implements isp-platform-features.md §3.3 "RADIUS Accounting Phase C":
--   Extends the nas table with fields needed for CoA/Disconnect operations,
--   physical site association, redundancy, and NAS health monitoring.
--
-- Columns added (all via stored-procedure IF NOT EXISTS guards):
--   coa_port            SMALLINT UNSIGNED NULL DEFAULT 3799
--                         — CoA/Disconnect UDP port (RFC 5176); suspensionService
--                           already queries n.coa_port, so guard handles the case
--                           where it was added in a Phase A/B migration.
--   location            VARCHAR(200) NULL
--                         — Free-text physical location description.
--   site_id             BIGINT UNSIGNED NULL
--                         — FK → sites(id) ON DELETE SET NULL ON UPDATE CASCADE.
--   secondary_nas_id    BIGINT UNSIGNED NULL
--                         — Self-referencing FK → nas(id) ON DELETE SET NULL
--                           for active/standby redundancy pairs.
--   health_status       ENUM('unknown','up','down') NOT NULL DEFAULT 'unknown'
--                         — Current reachability as determined by nas_health_check task.
--   last_health_check_at DATETIME NULL
--                         — Timestamp of the most recent health probe.
--
-- FK constraints added (guarded via INFORMATION_SCHEMA.KEY_COLUMN_USAGE checks):
--   fk_nas_site      — nas.site_id → sites(id) ON DELETE SET NULL ON UPDATE CASCADE
--   fk_nas_secondary — nas.secondary_nas_id → nas(id) ON DELETE SET NULL ON UPDATE CASCADE
--
-- Indexes added (guarded via INFORMATION_SCHEMA.STATISTICS checks):
--   idx_nas_site_id          on nas(site_id)
--   idx_nas_secondary_nas_id on nas(secondary_nas_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Column: coa_port
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_coa_port;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_coa_port()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'coa_port'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN coa_port SMALLINT UNSIGNED NULL DEFAULT 3799
        COMMENT 'UDP port for CoA / Disconnect-Request (RFC 5176); typically 3799'
        AFTER type;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_coa_port();
DROP PROCEDURE IF EXISTS migration_232_add_nas_coa_port;

-- ---------------------------------------------------------------------------
-- Column: location
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_location;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_location()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'location'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN location VARCHAR(200) NULL
        COMMENT 'Free-text physical location description (e.g. "Rack 3, DC North")'
        AFTER description;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_location();
DROP PROCEDURE IF EXISTS migration_232_add_nas_location;

-- ---------------------------------------------------------------------------
-- Column: site_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_site_id;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_site_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'site_id'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN site_id BIGINT UNSIGNED NULL
        COMMENT 'Physical site where this NAS is installed (FK → sites.id; SET NULL on site deletion)'
        AFTER location;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_site_id();
DROP PROCEDURE IF EXISTS migration_232_add_nas_site_id;

-- ---------------------------------------------------------------------------
-- Column: secondary_nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_secondary_nas_id;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_secondary_nas_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'secondary_nas_id'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN secondary_nas_id BIGINT UNSIGNED NULL
        COMMENT 'Standby / secondary NAS for active-standby redundancy (self-ref FK → nas.id)'
        AFTER site_id;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_secondary_nas_id();
DROP PROCEDURE IF EXISTS migration_232_add_nas_secondary_nas_id;

-- ---------------------------------------------------------------------------
-- Column: health_status
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_health_status;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_health_status()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'health_status'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN health_status ENUM('unknown','up','down') NOT NULL DEFAULT 'unknown'
        COMMENT 'Current reachability state as determined by the nas_health_check scheduled task'
        AFTER secondary_nas_id;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_health_status();
DROP PROCEDURE IF EXISTS migration_232_add_nas_health_status;

-- ---------------------------------------------------------------------------
-- Column: last_health_check_at
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_nas_last_health_check_at;
DELIMITER //
CREATE PROCEDURE migration_232_add_nas_last_health_check_at()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'last_health_check_at'
  ) THEN
    ALTER TABLE nas
      ADD COLUMN last_health_check_at DATETIME NULL
        COMMENT 'Timestamp of the most recent RADIUS Status-Server health probe'
        AFTER health_status;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_nas_last_health_check_at();
DROP PROCEDURE IF EXISTS migration_232_add_nas_last_health_check_at;

-- ---------------------------------------------------------------------------
-- Index: idx_nas_site_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_idx_nas_site_id;
DELIMITER //
CREATE PROCEDURE migration_232_add_idx_nas_site_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'idx_nas_site_id'
  ) THEN
    ALTER TABLE nas
      ADD INDEX idx_nas_site_id (site_id);
  END IF;
END //
DELIMITER ;
CALL migration_232_add_idx_nas_site_id();
DROP PROCEDURE IF EXISTS migration_232_add_idx_nas_site_id;

-- ---------------------------------------------------------------------------
-- Index: idx_nas_secondary_nas_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_idx_nas_secondary_nas_id;
DELIMITER //
CREATE PROCEDURE migration_232_add_idx_nas_secondary_nas_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND INDEX_NAME   = 'idx_nas_secondary_nas_id'
  ) THEN
    ALTER TABLE nas
      ADD INDEX idx_nas_secondary_nas_id (secondary_nas_id);
  END IF;
END //
DELIMITER ;
CALL migration_232_add_idx_nas_secondary_nas_id();
DROP PROCEDURE IF EXISTS migration_232_add_idx_nas_secondary_nas_id;

-- ---------------------------------------------------------------------------
-- FK: fk_nas_site — nas.site_id → sites(id) ON DELETE SET NULL ON UPDATE CASCADE
-- Guarded via INFORMATION_SCHEMA.KEY_COLUMN_USAGE.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_fk_nas_site;
DELIMITER //
CREATE PROCEDURE migration_232_add_fk_nas_site()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA      = DATABASE()
      AND TABLE_NAME        = 'nas'
      AND CONSTRAINT_NAME   = 'fk_nas_site'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE nas
      ADD CONSTRAINT fk_nas_site
        FOREIGN KEY (site_id) REFERENCES sites (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_fk_nas_site();
DROP PROCEDURE IF EXISTS migration_232_add_fk_nas_site;

-- ---------------------------------------------------------------------------
-- FK: fk_nas_secondary — nas.secondary_nas_id → nas(id) ON DELETE SET NULL ON UPDATE CASCADE
-- Self-referencing FK; guarded via INFORMATION_SCHEMA.KEY_COLUMN_USAGE.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_232_add_fk_nas_secondary;
DELIMITER //
CREATE PROCEDURE migration_232_add_fk_nas_secondary()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA      = DATABASE()
      AND TABLE_NAME        = 'nas'
      AND CONSTRAINT_NAME   = 'fk_nas_secondary'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE nas
      ADD CONSTRAINT fk_nas_secondary
        FOREIGN KEY (secondary_nas_id) REFERENCES nas (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_232_add_fk_nas_secondary();
DROP PROCEDURE IF EXISTS migration_232_add_fk_nas_secondary;
