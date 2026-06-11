-- =============================================================================
-- Migration 273: RBAC Permissions for §7.4 Fiber Plant Management
-- =============================================================================
-- New permissions:
--   fiber_routes.*        — CRUD for fiber route topology records
--   odf_frames.*          — CRUD for ODF frame inventory
--   odf_ports.*           — CRUD for ODF port records
--   odf_cross_connects.*  — CRUD for ODF cross-connect records
--   otdr_tests.*          — CRUD for OTDR test results
--   sfp_inventory.*       — CRUD for SFP module lifecycle records
-- =============================================================================

INSERT IGNORE INTO permissions (name, description, module) VALUES
  -- Fiber routes
  ('fiber_routes.view',           'View fiber route topology records',                'monitoring'),
  ('fiber_routes.create',         'Create fiber route segment records',               'monitoring'),
  ('fiber_routes.update',         'Update fiber route records',                       'monitoring'),
  ('fiber_routes.delete',         'Delete fiber route records',                       'monitoring'),
  -- ODF frames
  ('odf_frames.view',             'View ODF frame inventory',                         'monitoring'),
  ('odf_frames.create',           'Create ODF frame records',                         'monitoring'),
  ('odf_frames.update',           'Update ODF frame records',                         'monitoring'),
  ('odf_frames.delete',           'Delete ODF frame records',                         'monitoring'),
  -- ODF ports
  ('odf_ports.view',              'View ODF fiber port records',                      'monitoring'),
  ('odf_ports.create',            'Create ODF port records',                          'monitoring'),
  ('odf_ports.update',            'Update ODF port records (status, cable label)',     'monitoring'),
  ('odf_ports.delete',            'Delete ODF port records',                          'monitoring'),
  -- ODF cross-connects
  ('odf_cross_connects.view',     'View ODF patch-cord cross-connect records',        'monitoring'),
  ('odf_cross_connects.create',   'Create cross-connect records',                     'monitoring'),
  ('odf_cross_connects.update',   'Update cross-connect records',                     'monitoring'),
  ('odf_cross_connects.delete',   'Delete cross-connect records',                     'monitoring'),
  -- OTDR tests
  ('otdr_tests.view',             'View OTDR test results and fault locations',        'monitoring'),
  ('otdr_tests.create',           'Create/import OTDR test result records',           'monitoring'),
  ('otdr_tests.update',           'Update OTDR test records',                         'monitoring'),
  ('otdr_tests.delete',           'Delete OTDR test records',                         'monitoring'),
  -- SFP inventory
  ('sfp_inventory.view',          'View SFP module lifecycle inventory',              'monitoring'),
  ('sfp_inventory.create',        'Add SFP module records',                           'monitoring'),
  ('sfp_inventory.update',        'Update SFP lifecycle status and details',          'monitoring'),
  ('sfp_inventory.delete',        'Delete SFP inventory records',                     'monitoring');

-- ---------------------------------------------------------------------------
-- admin: all 24 new permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'fiber_routes.view',           'fiber_routes.create',
           'fiber_routes.update',         'fiber_routes.delete',
           'odf_frames.view',             'odf_frames.create',
           'odf_frames.update',           'odf_frames.delete',
           'odf_ports.view',              'odf_ports.create',
           'odf_ports.update',            'odf_ports.delete',
           'odf_cross_connects.view',     'odf_cross_connects.create',
           'odf_cross_connects.update',   'odf_cross_connects.delete',
           'otdr_tests.view',             'otdr_tests.create',
           'otdr_tests.update',           'otdr_tests.delete',
           'sfp_inventory.view',          'sfp_inventory.create',
           'sfp_inventory.update',        'sfp_inventory.delete'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: all *.view + create/update for operational items
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'fiber_routes.view',
           'fiber_routes.create',
           'fiber_routes.update',
           'odf_frames.view',
           'odf_ports.view',
           'odf_ports.update',
           'odf_cross_connects.view',
           'odf_cross_connects.create',
           'odf_cross_connects.update',
           'otdr_tests.view',
           'otdr_tests.create',
           'sfp_inventory.view',
           'sfp_inventory.create',
           'sfp_inventory.update'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- readonly: *.view only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'fiber_routes.view',
           'odf_frames.view',
           'odf_ports.view',
           'odf_cross_connects.view',
           'otdr_tests.view',
           'sfp_inventory.view'
       )
WHERE  r.name = 'readonly';
