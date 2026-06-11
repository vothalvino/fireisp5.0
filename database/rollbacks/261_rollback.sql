-- Rollback for migration 261: RBAC Permissions for §6.5 Alerting & Notification

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions WHERE name IN (
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
);

DELETE FROM permissions WHERE name IN (
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
);
