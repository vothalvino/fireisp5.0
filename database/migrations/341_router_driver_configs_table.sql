-- =============================================================================
-- Migration 341 — §18.3 Router API Integration: driver configs + command executions
-- =============================================================================
-- Extends the existing device abstraction. MikroTik routerosService.js already
-- provides a live RouterOS API client. This migration adds a config table for
-- other vendors (Cisco, Juniper, ZTE/Huawei, generic REST) whose drivers are
-- STUBBED — command dispatch records are created but no live SSH/NETCONF call is made.
-- The MikroTik driver uses routerosService.js (already functional for FireRelay).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: router_driver_configs
-- Purpose: Vendor-specific connection and credential configuration per device.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS router_driver_configs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    device_id           BIGINT UNSIGNED NULL     COMMENT 'FK to devices.id (optional — can be org-level template)',
    vendor              ENUM('mikrotik','cisco_ios','cisco_iosxe','juniper_junos','zte','huawei','generic_rest')
                            NOT NULL DEFAULT 'mikrotik',
    protocol            ENUM('routeros_api','ssh','restconf','netconf','rest','tl1') NOT NULL DEFAULT 'routeros_api',
    host                VARCHAR(253)    NULL,
    port                SMALLINT UNSIGNED NOT NULL DEFAULT 8728,
    username            VARCHAR(255)    NULL,
    encrypted_password  TEXT            NULL     COMMENT 'AES-256-GCM encrypted via src/utils/encryption.js',
    api_token           TEXT            NULL     COMMENT 'AES-256-GCM encrypted API token (for REST/RESTCONF)',
    ssl_enabled         TINYINT(1)      NOT NULL DEFAULT 0,
    ssl_verify          TINYINT(1)      NOT NULL DEFAULT 1,
    timeout_ms          INT UNSIGNED    NOT NULL DEFAULT 10000,
    extra_params        JSON            NULL     COMMENT 'Driver-specific extra parameters (e.g. netconf_capability)',
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    last_tested_at      DATETIME        NULL,
    last_test_status    ENUM('ok','failed','pending') NULL,
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_router_driver_configs_org (organization_id),
    KEY idx_router_driver_configs_device (device_id),
    KEY idx_router_driver_configs_vendor (vendor),
    KEY idx_router_driver_configs_active (is_active),
    KEY idx_router_driver_configs_deleted_at (deleted_at),
    CONSTRAINT fk_router_driver_configs_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_router_driver_cfg_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Vendor router driver connection configs; non-MikroTik drivers are STUBBED (§18.3)';

-- ---------------------------------------------------------------------------
-- Table: device_command_executions
-- Purpose: Audit log of dispatched router commands.
--          Non-MikroTik vendors return status=stubbed (no live device call).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_command_executions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    driver_config_id    BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NULL,
    vendor              VARCHAR(50)     NOT NULL,
    command             VARCHAR(500)    NOT NULL COMMENT 'Command name or path dispatched',
    params              JSON            NULL     COMMENT 'Command parameters',
    status              ENUM('queued','success','failure','stubbed') NOT NULL DEFAULT 'queued'
                            COMMENT 'stubbed = non-MikroTik vendor, live dispatch not yet implemented',
    response            JSON            NULL     COMMENT 'Device response (MikroTik) or stubbed payload',
    error_message       TEXT            NULL,
    duration_ms         INT UNSIGNED    NULL,
    executed_by         BIGINT UNSIGNED NULL,
    executed_at         DATETIME        NOT NULL DEFAULT (NOW()),
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_dev_cmd_exec_org (organization_id),
    KEY idx_dev_cmd_exec_driver (driver_config_id),
    KEY idx_dev_cmd_exec_device (device_id),
    KEY idx_dev_cmd_exec_vendor (vendor),
    KEY idx_dev_cmd_exec_status (status),
    KEY idx_dev_cmd_exec_executed_at (executed_at),
    CONSTRAINT fk_dev_cmd_exec_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dev_cmd_exec_driver FOREIGN KEY (driver_config_id)
        REFERENCES router_driver_configs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dev_cmd_exec_executed_by FOREIGN KEY (executed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Router command dispatch audit log; non-MikroTik is STUBBED (§18.3)';
