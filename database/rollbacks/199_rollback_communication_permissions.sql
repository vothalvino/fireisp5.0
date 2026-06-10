-- =============================================================================
-- FireISP 5.0 — Rollback 199: Remove Communication module permissions
-- =============================================================================
-- Reverses migration 199. role_permissions rows are removed first to satisfy
-- the FK constraint, then the permission definitions themselves.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'communication';

DELETE FROM permissions WHERE module = 'communication';
