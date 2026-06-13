-- =============================================================================
-- Rollback 343 — Remove §18 permissions, role_permissions, and scheduled tasks
-- =============================================================================
DELETE FROM scheduled_tasks WHERE task_name IN ('anomaly_detection', 'churn_score_computation', 'remediation_evaluation');

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module IN ('automation', 'analytics')
  AND p.name LIKE 'automation_rules.%'
   OR p.name LIKE 'batch_jobs.%'
   OR p.name LIKE 'provisioning_pipelines.%'
   OR p.name LIKE 'remediation_rules.%'
   OR p.name LIKE 'automation_scripts.%'
   OR p.name LIKE 'script_executions.%'
   OR p.name LIKE 'router_driver_configs.%'
   OR p.name LIKE 'device_command_executions.%'
   OR p.name LIKE 'analytics_anomalies.%'
   OR p.name LIKE 'churn_scores.%';

DELETE FROM permissions WHERE name IN (
  'automation_rules.view', 'automation_rules.create', 'automation_rules.update',
  'automation_rules.delete', 'automation_rules.execute',
  'batch_jobs.view', 'batch_jobs.create', 'batch_jobs.cancel',
  'provisioning_pipelines.view', 'provisioning_pipelines.create',
  'remediation_rules.view', 'remediation_rules.create', 'remediation_rules.update',
  'remediation_rules.delete',
  'automation_scripts.view', 'automation_scripts.create', 'automation_scripts.update',
  'automation_scripts.delete', 'automation_scripts.execute',
  'script_executions.view',
  'router_driver_configs.view', 'router_driver_configs.create',
  'router_driver_configs.update', 'router_driver_configs.delete',
  'device_command_executions.view', 'device_command_executions.execute',
  'analytics_anomalies.view', 'analytics_anomalies.acknowledge',
  'churn_scores.view', 'churn_scores.compute'
);
