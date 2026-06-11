-- =============================================================================
-- Rollback 273: Remove §7.4 Fiber Plant Management permissions
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
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
);

DELETE FROM permissions WHERE name IN (
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
);
