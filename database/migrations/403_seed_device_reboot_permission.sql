-- =============================================================================
-- Migration 403: devices.reboot permission (generic device reboot action)
-- =============================================================================
-- Backs POST /devices/:id/reboot. Destructive, so granted only to admin and
-- technician — NOT support / billing / readonly.
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'devices.reboot', 'Reboot a network device via its driver/type mechanism', 'devices'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'devices.reboot');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'devices.reboot'
WHERE r.name IN ('admin', 'technician')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- END OF MIGRATION 403
