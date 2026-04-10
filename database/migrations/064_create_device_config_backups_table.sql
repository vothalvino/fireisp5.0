-- Migration: 064_create_device_config_backups_table
-- Description: Versioned configuration snapshots per device.
--              Stores MikroTik exports, RouterOS backups, Cisco running-config,
--              and similar config captures.  Each row is an immutable snapshot
--              with a SHA-256 checksum for change detection and deduplication.

CREATE TABLE IF NOT EXISTS device_config_backups (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    device_id       BIGINT UNSIGNED  NOT NULL COMMENT 'Device this config snapshot belongs to',
    version         INT UNSIGNED     NOT NULL DEFAULT 1
                                     COMMENT 'Monotonically increasing version number per device',
    config_type     ENUM('mikrotik_export', 'mikrotik_compact', 'mikrotik_backup',
                         'running_config', 'startup_config', 'full_backup', 'other')
                                     NOT NULL DEFAULT 'running_config'
                                     COMMENT 'Format / flavour of the captured configuration',
    content         LONGTEXT         NOT NULL COMMENT 'Full configuration text',
    file_size       INT UNSIGNED     NOT NULL DEFAULT 0
                                     COMMENT 'Size of the config content in bytes',
    checksum        VARCHAR(64)      NOT NULL COMMENT 'SHA-256 hash of content for change detection and deduplication',
    change_summary  TEXT             NULL     COMMENT 'Human-readable summary of what changed since the previous version',
    capture_method  ENUM('manual', 'scheduled', 'pre_change', 'post_change')
                                     NOT NULL DEFAULT 'manual'
                                     COMMENT 'How the backup was triggered',
    captured_by_user_id BIGINT UNSIGNED NULL  COMMENT 'User who initiated the capture; NULL = system / automated',
    notes           TEXT             NULL     COMMENT 'Free-form operator notes',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_device_config_backups_device_version (device_id, version),
    KEY idx_device_config_backups_device_id (device_id),
    KEY idx_device_config_backups_config_type (config_type),
    KEY idx_device_config_backups_capture_method (capture_method),
    KEY idx_device_config_backups_checksum (checksum),
    KEY idx_device_config_backups_created_at (created_at),
    CONSTRAINT fk_device_config_backups_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_device_config_backups_user FOREIGN KEY (captured_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
