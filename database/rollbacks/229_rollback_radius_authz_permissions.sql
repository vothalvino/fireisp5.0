-- =============================================================================
-- Rollback 229: Remove RADIUS authorization permissions
-- =============================================================================

DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE name IN (
        'plan_access_windows.view',
        'plan_access_windows.create',
        'plan_access_windows.update',
        'plan_access_windows.delete',
        'radius_account_routes.view',
        'radius_account_routes.create',
        'radius_account_routes.update',
        'radius_account_routes.delete',
        'walled_garden.view',
        'walled_garden.update',
        'radius.kick_sessions'
    )
);

DELETE FROM permissions WHERE name IN (
    'plan_access_windows.view',
    'plan_access_windows.create',
    'plan_access_windows.update',
    'plan_access_windows.delete',
    'radius_account_routes.view',
    'radius_account_routes.create',
    'radius_account_routes.update',
    'radius_account_routes.delete',
    'walled_garden.view',
    'walled_garden.update',
    'radius.kick_sessions'
);
