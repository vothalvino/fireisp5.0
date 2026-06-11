-- =============================================================================
-- Rollback 246: Remove dual-stack permissions
-- =============================================================================
-- Reverses migration 246. Remove role_permissions rows first (FK child),
-- then remove permission rows.
-- =============================================================================

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'dhcp_servers.view',
    'dhcp_servers.create',
    'dhcp_servers.update',
    'dhcp_servers.delete',
    'dhcp_reservations.view',
    'dhcp_reservations.create',
    'dhcp_reservations.update',
    'dhcp_reservations.delete',
    'nat_pools.view',
    'nat_pools.create',
    'nat_pools.update',
    'nat_pools.delete',
    'ptr_records.view',
    'ptr_records.create',
    'ptr_records.update',
    'ptr_records.delete',
    'ra_guard.view',
    'ra_guard.create',
    'ra_guard.update',
    'ra_guard.delete',
    'transition_mechanisms.view',
    'transition_mechanisms.create',
    'transition_mechanisms.update',
    'transition_mechanisms.delete',
    'ipv6.management'
  )
);

DELETE FROM permissions
WHERE name IN (
  'dhcp_servers.view',
  'dhcp_servers.create',
  'dhcp_servers.update',
  'dhcp_servers.delete',
  'dhcp_reservations.view',
  'dhcp_reservations.create',
  'dhcp_reservations.update',
  'dhcp_reservations.delete',
  'nat_pools.view',
  'nat_pools.create',
  'nat_pools.update',
  'nat_pools.delete',
  'ptr_records.view',
  'ptr_records.create',
  'ptr_records.update',
  'ptr_records.delete',
  'ra_guard.view',
  'ra_guard.create',
  'ra_guard.update',
  'ra_guard.delete',
  'transition_mechanisms.view',
  'transition_mechanisms.create',
  'transition_mechanisms.update',
  'transition_mechanisms.delete',
  'ipv6.management'
);
