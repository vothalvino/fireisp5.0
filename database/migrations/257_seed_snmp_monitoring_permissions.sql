-- =============================================================================
-- Migration 257: RBAC Permissions for §6.2/6.3 SNMP metric monitoring endpoints
-- =============================================================================
-- Implements isp-platform-features.md §6.2/6.3 "Traffic Monitoring":
--   Seeds 3 permissions covering SNMP metric data viewing, top-talker reports,
--   and per-interface statistics.
--
-- Permissions seeded (3 total):
--   snmp_metrics.view          — View SNMP metric data and bandwidth graphs
--   snmp_metrics.top_talkers   — View top talkers by interface/subscriber
--   snmp_metrics.interfaces    — View per-interface stats and utilization
--
-- Role matrix:
--   admin       — all 3 permissions
--   technician  — all 3 permissions
--   readonly    — snmp_metrics.view only
--
-- Uses INSERT IGNORE — safe to re-run.
--
-- Requires:
--   049_create_roles_permissions_tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('snmp_metrics.view',        'View SNMP metric data and bandwidth graphs',        'monitoring'),
  ('snmp_metrics.top_talkers', 'View top talkers by interface/subscriber',          'monitoring'),
  ('snmp_metrics.interfaces',  'View per-interface stats and utilization',          'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 3 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'snmp_metrics.view',
           'snmp_metrics.top_talkers',
           'snmp_metrics.interfaces'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: all 3 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'snmp_metrics.view',
           'snmp_metrics.top_talkers',
           'snmp_metrics.interfaces'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: snmp_metrics.view only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name = 'snmp_metrics.view'
WHERE  r.name = 'readonly';

-- END OF MIGRATION 257
