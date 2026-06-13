-- Migration 327 — firewall_rules table
-- Purpose: Network firewall rules per subscriber IP pool (action, protocol, src/dst ip/port, priority).
-- Tables: firewall_rules

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS firewall_rules (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Tenant org; NULL = single-tenant',
    pool_id             BIGINT UNSIGNED NULL COMMENT 'FK to ip_pools; NULL = applies to all pools',
    name                VARCHAR(150)    NOT NULL,
    description         TEXT            NULL,
    action              ENUM('allow','deny','drop','reject','log') NOT NULL DEFAULT 'deny',
    direction           ENUM('inbound','outbound','both') NOT NULL DEFAULT 'both',
    protocol            ENUM('tcp','udp','icmp','icmpv6','esp','ah','gre','any') NOT NULL DEFAULT 'any',
    src_ip              VARCHAR(50)     NULL COMMENT 'Source IP or CIDR; NULL = any',
    src_port            VARCHAR(50)     NULL COMMENT 'Source port or range (e.g. 1024-65535); NULL = any',
    dst_ip              VARCHAR(50)     NULL COMMENT 'Destination IP or CIDR; NULL = any',
    dst_port            VARCHAR(50)     NULL COMMENT 'Destination port or range; NULL = any',
    priority            SMALLINT        NOT NULL DEFAULT 100 COMMENT 'Lower value = higher priority; evaluated in order',
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    log_matches         TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Log matched packets to audit_logs',
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_firewall_rules_org (organization_id),
    KEY idx_firewall_rules_pool (pool_id),
    KEY idx_firewall_rules_priority (priority),
    KEY idx_firewall_rules_active (is_active),
    KEY idx_firewall_rules_deleted_at (deleted_at),
    CONSTRAINT fk_firewall_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_firewall_rules_pool FOREIGN KEY (pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_firewall_rules_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Network firewall rules per subscriber IP pool (§17)';
