-- =============================================================================
-- Migration 393: Grant WireGuard self-service peer permissions to billing +
--                readonly
-- =============================================================================
-- Migration 365 seeded wireguard.peers.* and granted the self-service set
-- (view/create/delete own peers) to technician + support only. But the
-- "My VPN Tunnels" page (/wg-tunnels) has always been rendered in the sidebar
-- for every role, so billing and readonly users clicked a row that 403'd —
-- the classic unseeded-grant bug (readonly's blanket "%.view" grant from 119
-- predates these permissions and never picked them up).
--
--   billing  — full self-service like technician/support (view/create/delete
--              own peers; office staff need remote access tunnels too)
--   readonly — wireguard.peers.view only ("sees everything, changes nothing")
--
-- INSERT IGNORE keeps this idempotent; no schema change (grants only).
-- =============================================================================

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'wireguard.peers.view',
    'wireguard.peers.create',
    'wireguard.peers.delete'
)
WHERE r.name = 'billing';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'wireguard.peers.view'
WHERE r.name = 'readonly';
