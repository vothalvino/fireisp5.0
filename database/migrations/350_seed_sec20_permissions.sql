-- =============================================================================
-- Migration 350 — §20 APIs & Integrations: seed permissions
-- =============================================================================

-- Integration providers (read-only for all admins)
INSERT INTO permissions (name, description, module)
SELECT 'integration_providers.view', 'View available integration providers catalog', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_providers.view'
);

-- Integration connections (CRUD + test + sync)
INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.view', 'View integration connections for the organization', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.view'
);

INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.create', 'Create new integration connections', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.create'
);

INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.update', 'Update integration connection settings and credentials', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.update'
);

INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.delete', 'Delete integration connections', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.delete'
);

INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.test', 'Test an integration connection', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.test'
);

INSERT INTO permissions (name, description, module)
SELECT 'integration_connections.sync', 'Trigger a manual sync for an integration connection', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_connections.sync'
);

-- Sync logs
INSERT INTO permissions (name, description, module)
SELECT 'integration_sync_logs.view', 'View integration sync execution logs', 'integrations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE name = 'integration_sync_logs.view'
);

-- Assign to admin and super_admin roles
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'integration_providers.view',
  'integration_connections.view',
  'integration_connections.create',
  'integration_connections.update',
  'integration_connections.delete',
  'integration_connections.test',
  'integration_connections.sync',
  'integration_sync_logs.view'
)
WHERE r.name IN ('admin', 'super_admin');
