-- Rollback for migration 350 — remove §20 permissions
DELETE FROM permissions WHERE name IN (
  'integration_providers.view',
  'integration_connections.view',
  'integration_connections.create',
  'integration_connections.update',
  'integration_connections.delete',
  'integration_connections.test',
  'integration_connections.sync',
  'integration_sync_logs.view'
);
