-- =============================================================================
-- Migration 261: RBAC Permissions for §6.5 Alerting & Notification
-- =============================================================================
-- Seeds 16 permissions for escalation chains, maintenance windows,
-- notification channels, and suppression rules.
--
-- Role matrix:
--   admin       — all 16 permissions
--   technician  — 8 permissions (all *.view + maintenance_windows.create/update
--                 + alert_channels.create/update)
--   readonly    — 4 permissions (all *.view)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('alert_escalations.view',    'View alert escalation chains',            'monitoring'),
  ('alert_escalations.create',  'Create alert escalation chains',          'monitoring'),
  ('alert_escalations.update',  'Update alert escalation chains',          'monitoring'),
  ('alert_escalations.delete',  'Delete alert escalation chains',          'monitoring'),
  ('maintenance_windows.view',  'View maintenance windows',                'monitoring'),
  ('maintenance_windows.create','Create maintenance windows',              'monitoring'),
  ('maintenance_windows.update','Update maintenance windows',              'monitoring'),
  ('maintenance_windows.delete','Delete maintenance windows',              'monitoring'),
  ('alert_channels.view',       'View alert notification channels',        'monitoring'),
  ('alert_channels.create',     'Create alert notification channels',      'monitoring'),
  ('alert_channels.update',     'Update alert notification channels',      'monitoring'),
  ('alert_channels.delete',     'Delete alert notification channels',      'monitoring'),
  ('alert_suppression.view',    'View alert suppression rules',            'monitoring'),
  ('alert_suppression.create',  'Create alert suppression rules',          'monitoring'),
  ('alert_suppression.update',  'Update alert suppression rules',          'monitoring'),
  ('alert_suppression.delete',  'Delete alert suppression rules',          'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 16 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'alert_escalations.view',
           'alert_escalations.create',
           'alert_escalations.update',
           'alert_escalations.delete',
           'maintenance_windows.view',
           'maintenance_windows.create',
           'maintenance_windows.update',
           'maintenance_windows.delete',
           'alert_channels.view',
           'alert_channels.create',
           'alert_channels.update',
           'alert_channels.delete',
           'alert_suppression.view',
           'alert_suppression.create',
           'alert_suppression.update',
           'alert_suppression.delete'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: 8 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'alert_escalations.view',
           'maintenance_windows.view',
           'maintenance_windows.create',
           'maintenance_windows.update',
           'alert_channels.view',
           'alert_channels.create',
           'alert_channels.update',
           'alert_suppression.view'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: 4 permissions (*.view)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'alert_escalations.view',
           'maintenance_windows.view',
           'alert_channels.view',
           'alert_suppression.view'
       )
WHERE  r.name = 'readonly';
