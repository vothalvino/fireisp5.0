-- =============================================================================
-- Migration 343 — §18 Permissions + Scheduled Tasks Seed
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §18.1 Workflow Automation permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('automation_rules.view',   'View workflow automation rules',             'automation'),
  ('automation_rules.create', 'Create workflow automation rules',           'automation'),
  ('automation_rules.update', 'Update workflow automation rules',           'automation'),
  ('automation_rules.delete', 'Delete workflow automation rules',           'automation'),
  ('automation_rules.execute','Manually trigger an automation rule',        'automation'),
  ('batch_jobs.view',         'View batch subscriber operation jobs',       'automation'),
  ('batch_jobs.create',       'Create batch subscriber operation jobs',     'automation'),
  ('batch_jobs.cancel',       'Cancel running batch jobs',                  'automation'),
  ('provisioning_pipelines.view',   'View provisioning pipeline runs',      'automation'),
  ('provisioning_pipelines.create', 'Trigger a provisioning pipeline run',  'automation'),
  ('remediation_rules.view',   'View auto-remediation rules',               'automation'),
  ('remediation_rules.create', 'Create auto-remediation rules',             'automation'),
  ('remediation_rules.update', 'Update auto-remediation rules',             'automation'),
  ('remediation_rules.delete', 'Delete auto-remediation rules',             'automation'),

-- ---------------------------------------------------------------------------
-- §18.2 Scripting Engine permissions
-- ---------------------------------------------------------------------------
  ('automation_scripts.view',    'View automation scripts',                  'automation'),
  ('automation_scripts.create',  'Create automation scripts (admin only)',   'automation'),
  ('automation_scripts.update',  'Update automation scripts',                'automation'),
  ('automation_scripts.delete',  'Delete automation scripts',                'automation'),
  ('automation_scripts.execute', 'Trigger script execution (admin only)',    'automation'),
  ('script_executions.view',     'View script execution logs',               'automation'),

-- ---------------------------------------------------------------------------
-- §18.3 Router API Integration permissions
-- ---------------------------------------------------------------------------
  ('router_driver_configs.view',   'View router driver configurations',      'network'),
  ('router_driver_configs.create', 'Create router driver configurations',    'network'),
  ('router_driver_configs.update', 'Update router driver configurations',    'network'),
  ('router_driver_configs.delete', 'Delete router driver configurations',    'network'),
  ('device_command_executions.view',    'View device command execution logs', 'network'),
  ('device_command_executions.execute', 'Dispatch a device command',          'network'),

-- ---------------------------------------------------------------------------
-- §18.4 AI/ML Analytics permissions
-- ---------------------------------------------------------------------------
  ('analytics_anomalies.view',        'View detected anomalies',             'analytics'),
  ('analytics_anomalies.acknowledge', 'Acknowledge anomaly detections',      'analytics'),
  ('churn_scores.view',               'View client churn risk scores',        'analytics'),
  ('churn_scores.compute',            'Trigger churn score computation',      'analytics');

-- ---------------------------------------------------------------------------
-- Grant §18 permissions to admin role
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.name IN (
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

-- Grant view/compute to noc_operator and super_admin
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('noc_operator', 'super_admin')
  AND p.name IN (
    'automation_rules.view', 'automation_rules.execute',
    'batch_jobs.view', 'batch_jobs.create', 'batch_jobs.cancel',
    'provisioning_pipelines.view', 'provisioning_pipelines.create',
    'remediation_rules.view', 'remediation_rules.create', 'remediation_rules.update',
    'automation_scripts.view', 'automation_scripts.execute',
    'script_executions.view',
    'router_driver_configs.view', 'device_command_executions.view',
    'device_command_executions.execute',
    'analytics_anomalies.view', 'analytics_anomalies.acknowledge',
    'churn_scores.view', 'churn_scores.compute'
  );

-- ---------------------------------------------------------------------------
-- Scheduled tasks for §18 (anomaly detection + churn scoring + remediation eval)
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, is_enabled, priority)
SELECT 'anomaly_detection', 'system', '*/15 * * * *', 1, 60
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'anomaly_detection'
);

INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, is_enabled, priority)
SELECT 'churn_score_computation', 'system', '0 2 * * *', 1, 40
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'churn_score_computation'
);

INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, is_enabled, priority)
SELECT 'remediation_evaluation', 'system', '*/5 * * * *', 1, 70
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'remediation_evaluation'
);
