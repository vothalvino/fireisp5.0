-- =============================================================================
-- Rollback 338 — Drop provisioning_pipelines + provisioning_pipeline_stages
-- =============================================================================
DROP TABLE IF EXISTS provisioning_pipeline_stages;
DROP TABLE IF EXISTS provisioning_pipelines;
