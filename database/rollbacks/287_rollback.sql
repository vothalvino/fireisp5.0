-- =============================================================================
-- Rollback 287: QoS / Speed Profile RBAC permissions seed — §10.1
-- =============================================================================

DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'quality_classes.view','quality_classes.create','quality_classes.update','quality_classes.delete',
    'queue_tree_nodes.view','queue_tree_nodes.create','queue_tree_nodes.update','queue_tree_nodes.delete',
    'queue_tree_nodes.export'
  )
);

DELETE FROM permissions WHERE name IN (
  'quality_classes.view','quality_classes.create','quality_classes.update','quality_classes.delete',
  'queue_tree_nodes.view','queue_tree_nodes.create','queue_tree_nodes.update','queue_tree_nodes.delete',
  'queue_tree_nodes.export'
);
