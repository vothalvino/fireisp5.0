-- =============================================================================
-- Migration 317: §16.6 Universal Service Obligation tables
-- =============================================================================
-- New tables:
--   uso_obligations        — USO tracking per obligation period
--   rural_coverage_reports — rural deployment reporting by locality
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: uso_obligations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uso_obligations (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    obligation_type ENUM('universal_service','rural_deployment',
                         'social_coverage','network_expansion') NOT NULL,
    description     TEXT            NOT NULL,
    target_metric   VARCHAR(100)    NULL COMMENT 'E.g. homes_passed, coverage_percent',
    target_value    DECIMAL(15,4)   NULL,
    actual_value    DECIMAL(15,4)   NULL,
    period_start    DATE            NOT NULL,
    period_end      DATE            NOT NULL,
    status          ENUM('pending','in_progress','met','partially_met',
                         'missed','reported') NOT NULL DEFAULT 'pending',
    reported_at     TIMESTAMP       NULL,
    authority_ref   VARCHAR(100)    NULL,
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_uso_obligations_org    (organization_id),
    KEY idx_uso_obligations_status (status),
    KEY idx_uso_obligations_period (period_start, period_end),
    CONSTRAINT fk_uso_obligations_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Universal Service Obligation tracking per obligation period (§16.6)';

-- ---------------------------------------------------------------------------
-- Table: rural_coverage_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rural_coverage_reports (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    report_period       VARCHAR(7)       NOT NULL COMMENT 'YYYY-MM',
    locality_name       VARCHAR(255)     NOT NULL,
    inegi_code          VARCHAR(10)      NULL,
    state               VARCHAR(100)     NULL,
    municipality        VARCHAR(100)     NULL,
    homes_passed        INT UNSIGNED     NOT NULL DEFAULT 0,
    homes_connected     INT UNSIGNED     NOT NULL DEFAULT 0,
    service_type        ENUM('broadband','mobile','fixed_wireless',
                             'fiber','satellite') NOT NULL,
    download_speed_mbps DECIMAL(10,2)    NULL,
    upload_speed_mbps   DECIMAL(10,2)    NULL,
    is_underserved      TINYINT(1)       NOT NULL DEFAULT 0,
    notes               TEXT             NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_rural_coverage_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Rural deployment coverage reports by INEGI locality (§16.6)';
