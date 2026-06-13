-- =============================================================================
-- Migration 342 — §18.4 AI/ML Analytics: anomaly detection + churn scores
-- =============================================================================
-- IMPLEMENTATION NOTE: These are HEURISTIC/STATISTICAL analytics, NOT real ML:
--   - Anomaly detection: z-score threshold over SNMP metrics (no ML model)
--   - Churn scoring: rule-based signal aggregation (tenure/payment/ticket signals)
--   - Forecasting: reuses §15 reportService.capacityForecast() (linear regression)
--   - Alert correlation: reuses §6 alertService.evaluateAlerts()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: analytics_anomalies
-- Purpose: Z-score anomaly detection results for traffic/device metrics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_anomalies (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    device_id           BIGINT UNSIGNED NULL,
    metric              VARCHAR(100)    NOT NULL COMMENT 'e.g. if_in_octets, cpu_usage, sfp_rx_power_dbm',
    detected_value      DECIMAL(20,4)   NOT NULL COMMENT 'Observed value that triggered the anomaly',
    baseline_mean       DECIMAL(20,4)   NULL     COMMENT 'Rolling mean used for z-score calculation',
    baseline_stddev     DECIMAL(20,4)   NULL     COMMENT 'Rolling stddev used for z-score calculation',
    z_score             DECIMAL(10,4)   NULL     COMMENT 'z = (value - mean) / stddev',
    severity            ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    anomaly_type        VARCHAR(100)    NOT NULL DEFAULT 'threshold' COMMENT 'threshold, z_score, sfp_degradation, onu_failure',
    description         TEXT            NULL,
    is_acknowledged     TINYINT(1)      NOT NULL DEFAULT 0,
    acknowledged_by     BIGINT UNSIGNED NULL,
    acknowledged_at     DATETIME        NULL,
    detected_at         DATETIME        NOT NULL DEFAULT (NOW()),
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_analytics_anomalies_org (organization_id),
    KEY idx_analytics_anomalies_device (device_id),
    KEY idx_analytics_anomalies_metric (metric),
    KEY idx_analytics_anomalies_severity (severity),
    KEY idx_analytics_anomalies_type (anomaly_type),
    KEY idx_analytics_anomalies_ack (is_acknowledged),
    KEY idx_analytics_anomalies_detected_at (detected_at),
    CONSTRAINT fk_analytics_anomalies_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_analytics_anomalies_acknowledged_by FOREIGN KEY (acknowledged_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Z-score anomaly detection results (heuristic, not ML) (§18.4)';

-- ---------------------------------------------------------------------------
-- Table: churn_scores
-- Purpose: Rule-based churn risk scoring per client (heuristic, not ML).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS churn_scores (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    client_id           BIGINT UNSIGNED NOT NULL,
    score               DECIMAL(5,2)    NOT NULL COMMENT '0.00-100.00 churn risk percentage',
    risk_band           ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
    tenure_months       SMALLINT UNSIGNED NULL    COMMENT 'Months since first contract',
    overdue_invoices    SMALLINT UNSIGNED NULL    COMMENT 'Count of currently overdue invoices',
    open_tickets        SMALLINT UNSIGNED NULL    COMMENT 'Count of currently open support tickets',
    suspensions_30d     SMALLINT UNSIGNED NULL    COMMENT 'Suspensions in the last 30 days',
    payments_late_90d   SMALLINT UNSIGNED NULL    COMMENT 'Late payments in the last 90 days',
    factors             JSON            NULL     COMMENT 'Array of {signal, weight, value} contributing factors',
    scored_at           DATETIME        NOT NULL DEFAULT (NOW()),
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_churn_scores_org (organization_id),
    KEY idx_churn_scores_client (client_id),
    KEY idx_churn_scores_risk_band (risk_band),
    KEY idx_churn_scores_score (score),
    KEY idx_churn_scores_scored_at (scored_at),
    CONSTRAINT fk_churn_scores_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_churn_scores_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Rule-based churn risk scores per client (heuristic, not ML) (§18.4)';
