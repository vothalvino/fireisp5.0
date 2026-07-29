-- Rollback 435 — remove the dedicated tax-exemption permission.
--
-- After this, tax_exempt falls back to being governed by `clients.update`
-- again, which SUPPORT holds — i.e. the pre-435 behaviour, not a lockout.
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'clients.tax_exemption';

DELETE FROM permissions WHERE name = 'clients.tax_exemption';
