-- =============================================================================
-- FireISP 5.0 — Rollback 197: Remove Interaction Tracking permissions
-- =============================================================================
-- Reverses migration 197. role_permissions rows are removed first to satisfy
-- the FK, then the permission definitions themselves.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'interactions';

DELETE FROM permissions WHERE module = 'interactions';
