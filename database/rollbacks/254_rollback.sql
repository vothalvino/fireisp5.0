-- =============================================================================
-- Rollback 254: Remove §6.1 discovery scheduled tasks
-- =============================================================================
-- Reverses migration 254.
-- Targets only global (organization_id IS NULL) rows to avoid touching any
-- tenant-scoped tasks with the same name.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name IN ('snmp_discovery_poll', 'snmp_trap_receiver')
  AND organization_id IS NULL;
