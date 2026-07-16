-- =============================================================================
-- Rollback 393: Revoke the WireGuard self-service grants added for billing +
--               readonly
-- =============================================================================

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'billing'
  AND p.name IN ('wireguard.peers.view', 'wireguard.peers.create', 'wireguard.peers.delete');

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'readonly'
  AND p.name = 'wireguard.peers.view';
