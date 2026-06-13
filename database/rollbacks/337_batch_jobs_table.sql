-- =============================================================================
-- Rollback 337 — Drop batch_jobs + batch_job_items
-- =============================================================================
DROP TABLE IF EXISTS batch_job_items;
DROP TABLE IF EXISTS batch_jobs;
