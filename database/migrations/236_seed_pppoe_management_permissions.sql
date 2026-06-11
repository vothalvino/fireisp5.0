-- =============================================================================
-- Migration 236: RBAC permissions and scheduled task for PPPoE Management Phase A
-- =============================================================================
-- Implements isp-platform-features.md §4.1 "PPPoE Management Phase A":
--   Seeds permissions for IP pool assignment, utilization monitoring,
--   IP-customer binding reporting, session NAS/port summaries, and
--   batch RADIUS disconnect operations.
--   Also registers the hourly pool utilization check scheduled task.
--
-- Permissions seeded:
--   ip_pools.assign          — assign next free IP from a pool to a subscriber
--   ip_pools.utilization     — view pool utilization statistics
--   ip_pools.binding_report  — export IP-customer binding report (compliance)
--   connection_logs.summary  — view active session NAS/port summary
--   radius.batch_disconnect  — batch force-disconnect PPPoE sessions
--
-- Role matrix:
--   admin       — all 5 permissions
--   technician  — ip_pools.assign, ip_pools.utilization,
--                  connection_logs.summary, radius.batch_disconnect
--   support     — connection_logs.summary
--   readonly    — ip_pools.utilization, connection_logs.summary
--   billing     — ip_pools.binding_report
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('ip_pools.assign',         'Assign next free IP from a pool to a subscriber',              'ip_pools'),
    ('ip_pools.utilization',    'View IP pool utilization statistics',                          'ip_pools'),
    ('ip_pools.binding_report', 'Export IP-customer binding report for compliance audits',      'ip_pools'),
    ('connection_logs.summary', 'View active session NAS/port summary',                        'connection_logs'),
    ('radius.batch_disconnect', 'Batch force-disconnect PPPoE sessions via RADIUS Disconnect',  'radius');

-- ---------------------------------------------------------------------------
-- admin: all 5 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'ip_pools.assign',
           'ip_pools.utilization',
           'ip_pools.binding_report',
           'connection_logs.summary',
           'radius.batch_disconnect'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: assign, utilization, connection_logs.summary, batch_disconnect
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'ip_pools.assign',
           'ip_pools.utilization',
           'connection_logs.summary',
           'radius.batch_disconnect'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- support: connection_logs.summary only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'connection_logs.summary'
       )
WHERE  r.name = 'support';

-- ---------------------------------------------------------------------------
-- readonly: utilization, connection_logs.summary
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'ip_pools.utilization',
           'connection_logs.summary'
       )
WHERE  r.name = 'readonly';

-- ---------------------------------------------------------------------------
-- billing: binding_report only (compliance export access)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'ip_pools.binding_report'
       )
WHERE  r.name = 'billing';

-- ---------------------------------------------------------------------------
-- Scheduled task: check_pool_utilization
-- Runs hourly; emits threshold alerts at 75% and 90% pool utilization.
-- Uses INSERT ... SELECT ... WHERE NOT EXISTS for idempotency — the UNIQUE
-- KEY on (organization_id, task_name) never collides when organization_id is
-- NULL, so INSERT IGNORE would duplicate the row on re-run.
-- priority is the ENUM('low','normal','high','critical') — the original
-- numeric literal 5 was out of range and was silently stored as '' by
-- INSERT IGNORE; the intended value is 'high'.
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT NULL, 'check_pool_utilization', 'Check IP pool utilization and emit threshold alerts at 75% and 90%', '0 * * * *', 1, 'high'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'check_pool_utilization' AND organization_id IS NULL
);
