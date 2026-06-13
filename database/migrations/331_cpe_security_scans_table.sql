-- Migration 331 — cpe_security_scans table
-- Purpose: CPE security scan results (scan type, result, default password detection).
-- Tables: cpe_security_scans

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cpe_security_scans (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    device_id               BIGINT UNSIGNED NULL COMMENT 'FK to devices.id',
    cpe_device_id           BIGINT UNSIGNED NULL COMMENT 'FK to cpe_devices.id',
    scan_type               ENUM('default_credentials','open_ports','firmware_cve','configuration_audit','full') NOT NULL DEFAULT 'full',
    status                  ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    default_password_found  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 if factory/default credentials detected',
    open_ports              JSON            NULL COMMENT 'Array of open port numbers found',
    cve_findings            JSON            NULL COMMENT 'Array of CVE IDs found in firmware',
    risk_level              ENUM('none','low','medium','high','critical') NULL DEFAULT 'none',
    result_summary          TEXT            NULL COMMENT 'Human-readable scan summary',
    raw_result              LONGTEXT        NULL COMMENT 'Full raw scan output (JSON or text)',
    started_at              DATETIME        NULL,
    completed_at            DATETIME        NULL,
    initiated_by            BIGINT UNSIGNED NULL COMMENT 'User who triggered the scan; NULL = auto/scheduled',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cpe_security_scans_org (organization_id),
    KEY idx_cpe_security_scans_device (device_id),
    KEY idx_cpe_security_scans_cpe_device (cpe_device_id),
    KEY idx_cpe_security_scans_scan_type (scan_type),
    KEY idx_cpe_security_scans_status (status),
    KEY idx_cpe_security_scans_risk_level (risk_level),
    KEY idx_cpe_security_scans_created_at (created_at),
    CONSTRAINT fk_cpe_security_scans_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_security_scans_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_security_scans_cpe_device FOREIGN KEY (cpe_device_id)
        REFERENCES cpe_devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_security_scans_initiated_by FOREIGN KEY (initiated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CPE security scan results including default credential detection (§17)';
