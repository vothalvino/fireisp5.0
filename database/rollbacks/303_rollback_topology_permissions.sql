-- Rollback 303
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'topology.view','topology.layer_switch','topology.impact_analysis','topology.dependency_manage',
    'mapping.view','mapping.customer_locations','mapping.coverage_edit',
    'mapping.fiber_routes','mapping.infrastructure','mapping.infrastructure_manage',
    'geofences.view','geofences.manage'
  )
);

DELETE FROM permissions
WHERE name IN (
  'topology.view','topology.layer_switch','topology.impact_analysis','topology.dependency_manage',
  'mapping.view','mapping.customer_locations','mapping.coverage_edit',
  'mapping.fiber_routes','mapping.infrastructure','mapping.infrastructure_manage',
  'geofences.view','geofences.manage'
);
