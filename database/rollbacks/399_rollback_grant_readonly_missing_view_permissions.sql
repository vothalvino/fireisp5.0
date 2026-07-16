-- =============================================================================
-- Rollback 399: Revoke the readonly view-only grants added by migration 399
-- =============================================================================

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'readonly'
  AND p.name IN (
    'pppoe.diagnostics',
    'cpe_profiles.view',
    'billing.tax_reports',
    'dsar_requests.view',
    'ai.policy.read',
    'automation_rules.view',
    'batch_jobs.view',
    'provisioning_pipelines.view',
    'remediation_rules.view',
    'automation_scripts.view',
    'script_executions.view',
    'router_driver_configs.view',
    'resellers.view',
    'integration_providers.view',
    'integration_connections.view',
    'integration_sync_logs.view',
    'support.conversations.view'
  );
