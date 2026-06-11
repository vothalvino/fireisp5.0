-- =============================================================================
-- Migration 270: PON Port Management enhancements (§7.3)
-- =============================================================================
-- Extends olt_ports with maintenance_mode / XGS-PON mode configuration.
-- Creates onu_migration_jobs for transactional ONU port reassignment.
--
-- New columns on olt_ports (guarded ALTER via stored procedure):
--   maintenance_mode    TINYINT(1)   — port is locked for maintenance
--   maintenance_note    VARCHAR(255) — reason for maintenance lock
--   maintenance_by      BIGINT UNSIGNED — user who locked port
--   maintenance_at      DATETIME     — when lock was set
--   xgspon_mode         ENUM(...)    — XGS-PON sub-mode (2.5G/10G/auto)
--   xgspon_mode_validated TINYINT(1) — validated against olt_vendor_capabilities
--
-- New table: onu_migration_jobs
--   Transactional record of ONU port reassignment operations.
--   State machine: pending → in_progress → completed / failed / cancelled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ALTER olt_ports: maintenance_mode + xgspon_mode columns
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_270_extend_olt_ports;

DELIMITER $$
CREATE PROCEDURE migration_270_extend_olt_ports()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'olt_ports'
      AND COLUMN_NAME  = 'maintenance_mode'
  ) THEN
    ALTER TABLE olt_ports
      ADD COLUMN maintenance_mode     TINYINT(1)      NOT NULL DEFAULT 0
          COMMENT 'Port locked for maintenance (admin_status may differ)'
          AFTER notes,
      ADD COLUMN maintenance_note     VARCHAR(255)    NULL
          COMMENT 'Reason for maintenance lock'
          AFTER maintenance_mode,
      ADD COLUMN maintenance_by       BIGINT UNSIGNED NULL
          COMMENT 'FK to users — operator who set maintenance mode'
          AFTER maintenance_note,
      ADD COLUMN maintenance_at       DATETIME        NULL
          COMMENT 'Timestamp when maintenance mode was enabled'
          AFTER maintenance_by;
  END IF;
END$$
DELIMITER ;

CALL migration_270_extend_olt_ports();
DROP PROCEDURE IF EXISTS migration_270_extend_olt_ports;

-- ---------------------------------------------------------------------------
-- ALTER olt_ports: xgspon_mode column
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_270_add_xgspon_mode;

DELIMITER $$
CREATE PROCEDURE migration_270_add_xgspon_mode()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'olt_ports'
      AND COLUMN_NAME  = 'xgspon_mode'
  ) THEN
    ALTER TABLE olt_ports
      ADD COLUMN xgspon_mode           ENUM('gpon','xgspon_2_5g','xgspon_10g','auto','none')
          NOT NULL DEFAULT 'none'
          COMMENT 'XGS-PON sub-mode for dual-mode GPON/XGS-PON ports'
          AFTER maintenance_at,
      ADD COLUMN xgspon_mode_validated TINYINT(1)      NOT NULL DEFAULT 0
          COMMENT '1 = mode validated against olt_vendor_capabilities.protocols'
          AFTER xgspon_mode;
  END IF;
END$$
DELIMITER ;

CALL migration_270_add_xgspon_mode();
DROP PROCEDURE IF EXISTS migration_270_add_xgspon_mode;

-- ---------------------------------------------------------------------------
-- Table: onu_migration_jobs
-- Purpose: Transactional record of ONU port-to-port reassignment operations.
--          Each migration moves one ONU from a source OLT port to a target
--          OLT port (potentially on the same or different OLT).
--          Actual on-device de-registration + re-registration is handled by
--          the background job processor (§7.1 stub-driver pattern).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_migration_jobs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    onu_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'') being migrated',
    source_olt_port_id  BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to olt_ports — current OLT port of the ONU',
    target_olt_port_id  BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to olt_ports — destination OLT port',
    source_olt_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — source OLT',
    target_olt_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — destination OLT',
    -- Job lifecycle
    status              ENUM('pending','in_progress','completed','failed','cancelled')
                            NOT NULL DEFAULT 'pending',
    scheduled_at        DATETIME        NULL
                            COMMENT 'Planned migration time; NULL = immediate',
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    -- Result detail
    error_message       TEXT            NULL,
    result_detail       JSON            NULL
                            COMMENT 'Per-step results from the driver',
    -- Audit
    created_by          BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — operator who requested migration',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_migration_jobs_organization_id (organization_id),
    KEY idx_onu_migration_jobs_onu_device_id (onu_device_id),
    KEY idx_onu_migration_jobs_source_port (source_olt_port_id),
    KEY idx_onu_migration_jobs_target_port (target_olt_port_id),
    KEY idx_onu_migration_jobs_status (status),
    KEY idx_onu_migration_jobs_scheduled_at (scheduled_at),
    KEY idx_onu_migration_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_migration_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_onu_device FOREIGN KEY (onu_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_source_port FOREIGN KEY (source_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_target_port FOREIGN KEY (target_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_source_olt FOREIGN KEY (source_olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_target_olt FOREIGN KEY (target_olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU port-to-port migration job records (§7.3)';
