-- =============================================================================
-- Rollback 233: Remove RADIUS accounting retention and NAS health check tasks
-- =============================================================================
-- Reverses migration 233. Removes the two global scheduled tasks seeded for
-- RADIUS Phase C accounting retention and NAS health monitoring.
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name IN (
    'purge_radius_accounting',
    'nas_health_check'
);
