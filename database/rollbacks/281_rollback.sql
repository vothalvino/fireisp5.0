-- =============================================================================
-- Rollback 281: Remove §9.1 Wireless RBAC Permission Seeds
-- =============================================================================
-- Reverses migration 281.
-- Removes the 15 wireless permissions and their role assignments.
-- role_permissions rows cascade-delete when permissions are deleted
-- (FK ON DELETE CASCADE on role_permissions.permission_id).
-- =============================================================================

DELETE FROM permissions WHERE name IN (
    'ap_sectors.view',
    'ap_sectors.create',
    'ap_sectors.update',
    'ap_sectors.delete',
    'ap_channel_plans.view',
    'ap_channel_plans.create',
    'ap_channel_plans.update',
    'ap_channel_plans.delete',
    'wireless_clients.view',
    'wireless_channels.view',
    'wireless_channels.manage',
    'ap_commands.view',
    'ap_commands.create',
    'wireless_speed_profiles.view',
    'wireless_speed_profiles.manage'
);
