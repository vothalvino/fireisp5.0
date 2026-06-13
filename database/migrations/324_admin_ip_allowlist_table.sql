-- Migration 324 — admin_ip_allowlist table
-- Purpose: Per-organization IP allowlist entries for admin panel access stored in DB (not env-only).
-- Tables: admin_ip_allowlist

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS admin_ip_allowlist (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Scoped to organization; NULL = global/single-tenant',
    cidr                VARCHAR(50)     NOT NULL COMMENT 'IPv4 or IPv6 CIDR, e.g. 203.0.113.0/24 or ::1/128',
    description         VARCHAR(255)    NULL COMMENT 'Human-readable label, e.g. "Office network"',
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_by          BIGINT UNSIGNED NULL COMMENT 'User who added this entry',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_admin_ip_allowlist_org_id (organization_id),
    KEY idx_admin_ip_allowlist_cidr (cidr),
    KEY idx_admin_ip_allowlist_active (is_active),
    KEY idx_admin_ip_allowlist_deleted_at (deleted_at),
    CONSTRAINT fk_admin_ip_allowlist_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_admin_ip_allowlist_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-org DB-driven IP allowlist entries for admin access (§17)';
