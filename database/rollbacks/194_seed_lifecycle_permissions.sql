-- =============================================================================
-- FireISP 5.0 — Rollback 194: Remove Customer Lifecycle permissions
-- =============================================================================
-- Reverses migration 194. role_permissions rows are removed first (FK), then
-- the permission slugs themselves.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'lifecycle';

DELETE FROM permissions WHERE module = 'lifecycle';
