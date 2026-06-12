-- =============================================================================
-- Migration 303: Topology & Mapping permissions — §13
-- =============================================================================

-- topology module (§13.1 Network Topology Map, §13.3 Dependency Mapping)
INSERT INTO permissions (name, description, module)
SELECT 'topology.view', 'View network topology map and device graph', 'topology'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'topology.view');

INSERT INTO permissions (name, description, module)
SELECT 'topology.layer_switch', 'Switch topology display layers (L2/L3/physical)', 'topology'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'topology.layer_switch');

INSERT INTO permissions (name, description, module)
SELECT 'topology.impact_analysis', 'Run device failure impact analysis', 'topology'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'topology.impact_analysis');

INSERT INTO permissions (name, description, module)
SELECT 'topology.dependency_manage', 'Create and delete device dependency edges', 'topology'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'topology.dependency_manage');

-- mapping module (§13.2 Geographic Mapping)
INSERT INTO permissions (name, description, module)
SELECT 'mapping.view', 'View geographic maps and overlays', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.view');

INSERT INTO permissions (name, description, module)
SELECT 'mapping.customer_locations', 'View customer location pins on the map', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.customer_locations');

INSERT INTO permissions (name, description, module)
SELECT 'mapping.coverage_edit', 'Create and edit coverage zone polygons', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.coverage_edit');

INSERT INTO permissions (name, description, module)
SELECT 'mapping.fiber_routes', 'View fiber route polylines on the map', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.fiber_routes');

INSERT INTO permissions (name, description, module)
SELECT 'mapping.infrastructure', 'View infrastructure map pins (towers, cabinets, ODFs)', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.infrastructure');

INSERT INTO permissions (name, description, module)
SELECT 'mapping.infrastructure_manage', 'Create and manage infrastructure map pins', 'mapping'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mapping.infrastructure_manage');

-- geofences module (§13.2 Geofencing alerts)
INSERT INTO permissions (name, description, module)
SELECT 'geofences.view', 'View geofence zones', 'geofences'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'geofences.view');

INSERT INTO permissions (name, description, module)
SELECT 'geofences.manage', 'Create, edit, and delete geofence zones', 'geofences'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'geofences.manage');

-- ---------------------------------------------------------------------------
-- Role assignments
-- ---------------------------------------------------------------------------

-- admin: all 12
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'topology.view','topology.layer_switch','topology.impact_analysis','topology.dependency_manage',
  'mapping.view','mapping.customer_locations','mapping.coverage_edit',
  'mapping.fiber_routes','mapping.infrastructure','mapping.infrastructure_manage',
  'geofences.view','geofences.manage'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: topology.view, topology.impact_analysis, mapping.view,
--             mapping.customer_locations, mapping.fiber_routes,
--             mapping.infrastructure, geofences.view, geofences.manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'topology.view','topology.impact_analysis',
  'mapping.view','mapping.customer_locations','mapping.fiber_routes','mapping.infrastructure',
  'geofences.view','geofences.manage'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- support: topology.view, topology.impact_analysis,
--          mapping.view, mapping.customer_locations
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'topology.view','topology.impact_analysis',
  'mapping.view','mapping.customer_locations'
)
WHERE r.name = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: topology.view, mapping.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'topology.view',
  'mapping.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
