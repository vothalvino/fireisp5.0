-- Migration 330 — dns_blocklists table
-- Purpose: DNS blocklist entries per organization (malware, phishing, ads categories).
-- Tables: dns_blocklists

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS dns_blocklists (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Tenant org; NULL = global/single-tenant',
    domain              VARCHAR(253)    NOT NULL COMMENT 'FQDN to block (e.g. malware.example.com)',
    category            ENUM('malware','phishing','ads','spam','adult','gambling','botnet','other')
                            NOT NULL DEFAULT 'malware',
    entry_type          ENUM('manual','auto_import','threat_feed') NOT NULL DEFAULT 'manual',
    threat_feed_source  VARCHAR(150)    NULL COMMENT 'Name of threat intelligence feed (if auto_import)',
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    expires_at          DATETIME        NULL COMMENT 'Auto-expire; NULL = permanent',
    added_by            BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_dns_blocklists_org_domain (organization_id, domain),
    KEY idx_dns_blocklists_org (organization_id),
    KEY idx_dns_blocklists_domain (domain),
    KEY idx_dns_blocklists_category (category),
    KEY idx_dns_blocklists_active (is_active),
    KEY idx_dns_blocklists_deleted_at (deleted_at),
    CONSTRAINT fk_dns_blocklists_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dns_blocklists_added_by FOREIGN KEY (added_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='DNS blocklist entries per organization (§17)';
