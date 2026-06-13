-- Rollback: 347_seed_sec19_permissions
-- Removes §19 permissions from role_permissions and permissions tables.

DELETE rp FROM role_permissions rp
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module = 'resellers';

DELETE FROM permissions WHERE module = 'resellers';
