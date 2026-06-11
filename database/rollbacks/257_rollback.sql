-- =============================================================================
-- Rollback 257: Remove SNMP metrics monitoring permissions
-- =============================================================================
-- Reverses migration 257:
--   1. Removes role_permissions rows for the 3 snmp_metrics permissions.
--   2. Removes the 3 permission rows themselves.
-- =============================================================================

-- Remove role assignments first (FK child before parent)
DELETE rp
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
  'snmp_metrics.view',
  'snmp_metrics.top_talkers',
  'snmp_metrics.interfaces'
);

-- Remove permission definitions
DELETE FROM permissions
WHERE name IN (
  'snmp_metrics.view',
  'snmp_metrics.top_talkers',
  'snmp_metrics.interfaces'
);
