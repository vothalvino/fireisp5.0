-- =============================================================================
-- Rollback 240: Remove PPPoE Phase B permissions and scheduled task
-- =============================================================================

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'pppoe_service_profiles.view',
    'pppoe_service_profiles.create',
    'pppoe_service_profiles.update',
    'pppoe_service_profiles.delete',
    'pppoe.diagnostics',
    'pppoe.events_ingest'
  )
);

DELETE FROM permissions
WHERE name IN (
  'pppoe_service_profiles.view',
  'pppoe_service_profiles.create',
  'pppoe_service_profiles.update',
  'pppoe_service_profiles.delete',
  'pppoe.diagnostics',
  'pppoe.events_ingest'
);

DELETE FROM scheduled_tasks WHERE task_name = 'scan_auth_failures';
