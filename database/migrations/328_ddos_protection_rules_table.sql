-- Migration 328 — ddos_protection_rules table
-- Purpose: DDoS Flowspec/RTBH mitigation rules (type, target prefix, action, status).
-- Tables: ddos_protection_rules

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ddos_protection_rules (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(150)    NOT NULL,
    rule_type           ENUM('flowspec','rtbh','scrubbing','rate_limit') NOT NULL DEFAULT 'rtbh'
                            COMMENT 'Mitigation mechanism: Flowspec (RFC 5575), RTBH, scrubbing center, or rate limiting',
    target_prefix       VARCHAR(50)     NOT NULL COMMENT 'Target IP prefix under attack (CIDR notation)',
    target_protocol     ENUM('tcp','udp','icmp','any') NULL DEFAULT 'any',
    target_port         VARCHAR(50)     NULL COMMENT 'Port or range; NULL = all ports',
    action              ENUM('blackhole','rate_limit','redirect_scrubbing','flowspec_drop','monitor_only') NOT NULL DEFAULT 'blackhole',
    bandwidth_threshold_mbps INT UNSIGNED NULL COMMENT 'Traffic threshold that triggers auto-activation (Mbps)',
    pps_threshold       BIGINT UNSIGNED NULL COMMENT 'Packets-per-second threshold for auto-activation',
    status              ENUM('inactive','active','auto_triggered','expired') NOT NULL DEFAULT 'inactive',
    triggered_at        DATETIME        NULL COMMENT 'When this rule was last activated',
    expires_at          DATETIME        NULL COMMENT 'Auto-deactivation time; NULL = manual only',
    activated_by        BIGINT UNSIGNED NULL COMMENT 'User who manually activated; NULL = auto',
    notes               TEXT            NULL,
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_ddos_protection_rules_org (organization_id),
    KEY idx_ddos_protection_rules_status (status),
    KEY idx_ddos_protection_rules_prefix (target_prefix),
    KEY idx_ddos_protection_rules_deleted_at (deleted_at),
    CONSTRAINT fk_ddos_protection_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ddos_protection_rules_activated_by FOREIGN KEY (activated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ddos_protection_rules_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='DDoS Flowspec/RTBH mitigation rules (§17)';
