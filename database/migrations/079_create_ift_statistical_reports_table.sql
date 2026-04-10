-- Migration: 079_create_ift_statistical_reports_table
-- Description: Pre-aggregated IFT/CRT reporting snapshots.
--              Mexican ISPs must periodically report subscriber counts, download/
--              upload speeds, geographic coverage, and revenue data to the regulator.
--              This table stores a snapshot per organization per reporting period
--              (e.g. 2026-Q1, 2026-06) so that the data can be reviewed internally,
--              exported in the required format, and linked back to the official
--              filing record once submitted.

-- Disable FK checks: organizations and regulatory_filings created in earlier migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS ift_statistical_reports (
    id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id             BIGINT UNSIGNED NOT NULL
                                    COMMENT 'Organization this report snapshot belongs to',

    -- Reporting period
    report_period               VARCHAR(10)     NOT NULL
                                    COMMENT 'Human-readable period identifier (e.g. 2026-Q1, 2026-06, 2026-01)',
    period_start                DATE            NOT NULL
                                    COMMENT 'First day of the reporting period',
    period_end                  DATE            NOT NULL
                                    COMMENT 'Last day of the reporting period',

    -- Subscriber counts
    total_subscribers           INT UNSIGNED    NOT NULL DEFAULT 0
                                    COMMENT 'Total active subscribers at the end of the period',
    subscribers_by_speed_tier   JSON            NULL
                                    COMMENT 'JSON object: speed tier label => subscriber count (e.g. {"10Mbps":120,"50Mbps":300})',
    subscribers_by_state        JSON            NULL
                                    COMMENT 'JSON object: state code => subscriber count',
    subscribers_by_technology   JSON            NULL
                                    COMMENT 'JSON object: technology label => subscriber count (e.g. {"fiber":200,"wireless":220})',
    coverage_localities         JSON            NULL
                                    COMMENT 'JSON array of locality codes (INEGI AGEB / localidad) covered',

    -- Speed metrics
    avg_download_speed_mbps     DECIMAL(8, 2)   NULL
                                    COMMENT 'Average contracted download speed across all active subscribers (Mbps)',
    avg_upload_speed_mbps       DECIMAL(8, 2)   NULL
                                    COMMENT 'Average contracted upload speed across all active subscribers (Mbps)',

    -- Coverage
    coverage_municipalities     INT UNSIGNED    NULL
                                    COMMENT 'Number of municipalities with at least one active subscriber',

    -- Revenue (optional — may be omitted if reported separately)
    revenue_total               DECIMAL(14, 2)  NULL
                                    COMMENT 'Total gross revenue for the period in local currency; NULL if not included in this report',

    -- Filing linkage
    filed_at                    TIMESTAMP       NULL
                                    COMMENT 'Timestamp when this snapshot was submitted to IFT/CRT',
    filing_id                   BIGINT UNSIGNED NULL
                                    COMMENT 'Regulatory filing record this snapshot was submitted as part of',

    status                      ENUM('draft', 'final', 'filed')
                                    NOT NULL DEFAULT 'draft'
                                    COMMENT 'draft=being prepared; final=ready for submission; filed=submitted to regulator',

    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ift_statistical_reports_org_period (organization_id, report_period),
    KEY idx_ift_statistical_reports_organization_id (organization_id),
    KEY idx_ift_statistical_reports_status (status),
    KEY idx_ift_statistical_reports_period_start (period_start),
    KEY idx_ift_statistical_reports_filing_id (filing_id),
    CONSTRAINT fk_ift_statistical_reports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ift_statistical_reports_filing FOREIGN KEY (filing_id)
        REFERENCES regulatory_filings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
