-- =============================================================================
-- Migration 319: §16.8 Data Localization config table
-- =============================================================================
-- New tables:
--   data_residency_config — data localization flags and compliance status (one row per org)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: data_residency_config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_residency_config (
    id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id             BIGINT UNSIGNED NOT NULL,
    primary_storage_country     VARCHAR(2)      NOT NULL DEFAULT 'MX' COMMENT 'ISO 3166-1 alpha-2 country code',
    primary_storage_region      VARCHAR(100)    NULL COMMENT 'Cloud region or data center location',
    backup_storage_country      VARCHAR(2)      NULL,
    backup_storage_region       VARCHAR(100)    NULL,
    cross_border_transfers_allowed TINYINT(1)   NOT NULL DEFAULT 0,
    cross_border_destinations   JSON            NULL COMMENT 'List of allowed destination countries',
    dr_site_country             VARCHAR(2)      NULL,
    dr_site_region              VARCHAR(100)    NULL,
    last_compliance_check       TIMESTAMP       NULL,
    compliance_status           ENUM('compliant','non_compliant','unknown','under_review')
                                                NOT NULL DEFAULT 'unknown',
    notes                       TEXT            NULL,
    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_data_residency_config_org (organization_id),
    CONSTRAINT fk_data_residency_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Data localization flags and compliance status — one row per organization (§16.8)';
