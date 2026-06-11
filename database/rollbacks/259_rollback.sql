-- =============================================================================
-- Rollback 259: §6.4 Polling Engine — remove RBAC permissions
-- =============================================================================

-- Remove role_permissions rows first (FK reference)
DELETE rp
FROM   role_permissions rp
JOIN   permissions p ON p.id = rp.permission_id
WHERE  p.name IN (
  'poller_nodes.view',
  'poller_nodes.create',
  'poller_nodes.update',
  'poller_nodes.delete',
  'polling_configs.view',
  'polling_configs.create',
  'polling_configs.update',
  'polling_configs.delete',
  'poller_performance.view'
);

-- Remove permissions
DELETE FROM permissions
WHERE name IN (
  'poller_nodes.view',
  'poller_nodes.create',
  'poller_nodes.update',
  'poller_nodes.delete',
  'polling_configs.view',
  'polling_configs.create',
  'polling_configs.update',
  'polling_configs.delete',
  'poller_performance.view'
);

-- END OF ROLLBACK 259
