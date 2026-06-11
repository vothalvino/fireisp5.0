-- =============================================================================
-- Migration 228: radius_account_routes table (item 15 — route injection per session)
-- =============================================================================
-- Implements isp-platform-features.md §3.2 item 15.
-- Each row becomes one Framed-Route radreply attribute when synced:
--   Format: "<destination> <gateway> <metric>"
--   e.g.    "192.0.2.0/24 10.0.0.1 1"
-- gateway and metric are optional; when absent the FreeRADIUS standard format
-- omits them (or uses "0.0.0.0 1" per RFC 2865 §5.22).
-- =============================================================================

CREATE TABLE IF NOT EXISTS radius_account_routes (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    radius_account_id   BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NULL,
    destination         VARCHAR(50)     NOT NULL
                            COMMENT 'Destination CIDR (e.g. 192.168.10.0/24 or 10.0.0.0/8)',
    gateway             VARCHAR(45)     NULL
                            COMMENT 'Next-hop gateway IP; NULL = omitted in Framed-Route value',
    metric              TINYINT UNSIGNED NULL
                            COMMENT 'Route metric; NULL = omitted in Framed-Route value',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_radius_account_routes_account_id (radius_account_id),
    KEY idx_radius_account_routes_org_id (organization_id),
    KEY idx_radius_account_routes_deleted_at (deleted_at),
    CONSTRAINT fk_radius_account_routes_account FOREIGN KEY (radius_account_id)
        REFERENCES radius (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
