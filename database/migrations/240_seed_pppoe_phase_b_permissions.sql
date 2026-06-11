-- =============================================================================
-- Migration 240: RBAC permissions and scheduled task for PPPoE Phase B
-- =============================================================================
-- Implements isp-platform-features.md §4 "PPPoE Management Phase B":
--   Seeds permissions for PPPoE service profile management, diagnostics
--   (auth-failure classification, MTU issue detection), and M2M event ingest.
--   Also registers the scan_auth_failures scheduled task (every 15 min).
--
-- Permissions seeded:
--   pppoe_service_profiles.view   — view PPPoE service profiles
--   pppoe_service_profiles.create — create PPPoE service profiles
--   pppoe_service_profiles.update — update PPPoE service profiles
--   pppoe_service_profiles.delete — delete PPPoE service profiles
--   pppoe.diagnostics             — view auth failures, event logs, MTU issues
--   pppoe.events_ingest           — machine-to-machine POST /pppoe/events
--
-- Role matrix:
--   admin       — all 6 permissions
--   technician  — view + diagnostics + events_ingest
--   support     — pppoe.diagnostics
--   readonly    — pppoe_service_profiles.view
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('pppoe_service_profiles.view',   'View PPPoE service profiles',                                      'pppoe'),
  ('pppoe_service_profiles.create', 'Create PPPoE service profiles',                                    'pppoe'),
  ('pppoe_service_profiles.update', 'Update PPPoE service profiles',                                    'pppoe'),
  ('pppoe_service_profiles.delete', 'Delete PPPoE service profiles',                                    'pppoe'),
  ('pppoe.diagnostics',             'View PPPoE auth failures, event logs, and MTU advisories',         'pppoe'),
  ('pppoe.events_ingest',           'Machine-to-machine POST /pppoe/events for syslog ingest',          'pppoe');

-- ---------------------------------------------------------------------------
-- admin: all 6 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'pppoe_service_profiles.view',
           'pppoe_service_profiles.create',
           'pppoe_service_profiles.update',
           'pppoe_service_profiles.delete',
           'pppoe.diagnostics',
           'pppoe.events_ingest'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: view + diagnostics + events_ingest
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'pppoe_service_profiles.view',
           'pppoe.diagnostics',
           'pppoe.events_ingest'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- support: pppoe.diagnostics only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'pppoe.diagnostics'
       )
WHERE  r.name = 'support';

-- ---------------------------------------------------------------------------
-- readonly: pppoe_service_profiles.view only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'pppoe_service_profiles.view'
       )
WHERE  r.name = 'readonly';

-- ---------------------------------------------------------------------------
-- Scheduled task: scan_auth_failures
-- Runs every 15 min; classifies recent radpostauth rejections and emits
-- pppoe.auth_failures events for accounts exceeding the threshold.
-- Uses INSERT IGNORE — idempotent on re-run (UNIQUE KEY on task_name).
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks (task_name, description, cron_expression, is_enabled, priority)
VALUES (
  'scan_auth_failures',
  'Classify recent PPPoE auth failures from radpostauth and emit alerts for repeated failures',
  '*/15 * * * *',
  1,
  5
);
