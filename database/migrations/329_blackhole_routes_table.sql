-- Migration 329 — blackhole_routes table
-- Purpose: Blackhole routing records for subscriber IPs/prefixes under attack or policy violation.
-- Tables: blackhole_routes

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS blackhole_routes (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    prefix              VARCHAR(50)     NOT NULL COMMENT 'IPv4/IPv6 prefix or host address being blackholed',
    subscriber_id       BIGINT UNSIGNED NULL COMMENT 'FK to clients.id; NULL if non-subscriber prefix',
    reason              VARCHAR(500)    NOT NULL COMMENT 'Human-readable reason for blackholing',
    triggered_by        ENUM('manual','auto_ddos','policy','abuse','law_enforcement') NOT NULL DEFAULT 'manual',
    triggered_by_user   BIGINT UNSIGNED NULL COMMENT 'User who triggered manual blackhole',
    ddos_rule_id        BIGINT UNSIGNED NULL COMMENT 'FK to ddos_protection_rules if auto-triggered',
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    activated_at        DATETIME        NOT NULL COMMENT 'When blackhole was applied',
    expires_at          DATETIME        NULL COMMENT 'Scheduled deactivation; NULL = manual removal only',
    deactivated_at      DATETIME        NULL,
    deactivated_by      BIGINT UNSIGNED NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_blackhole_routes_org (organization_id),
    KEY idx_blackhole_routes_prefix (prefix),
    KEY idx_blackhole_routes_active (is_active),
    KEY idx_blackhole_routes_subscriber (subscriber_id),
    KEY idx_blackhole_routes_activated_at (activated_at),
    CONSTRAINT fk_blackhole_routes_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_blackhole_routes_subscriber FOREIGN KEY (subscriber_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_blackhole_routes_triggered_by_user FOREIGN KEY (triggered_by_user)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_blackhole_routes_ddos_rule FOREIGN KEY (ddos_rule_id)
        REFERENCES ddos_protection_rules (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_blackhole_routes_deactivated_by FOREIGN KEY (deactivated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Blackhole routing records for subscriber IPs/prefixes (§17)';
