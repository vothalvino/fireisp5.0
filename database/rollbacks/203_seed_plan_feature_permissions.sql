-- Rollback 203: Remove plan feature permissions

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('plans.radius_attributes','plans.speed_windows','plans.fup_throttle');

DELETE FROM permissions
WHERE name IN ('plans.radius_attributes','plans.speed_windows','plans.fup_throttle');
