-- =============================================================================
-- Rollback 342 — Drop analytics_anomalies + churn_scores
-- =============================================================================
DROP TABLE IF EXISTS churn_scores;
DROP TABLE IF EXISTS analytics_anomalies;
