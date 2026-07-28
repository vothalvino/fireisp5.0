-- =============================================================================
-- Rollback 432: take .manage on consents and DSARs back off the billing role
-- =============================================================================
-- Returns both to admin-only, the state migration 321 left them in. Note the
-- consequence of rolling back: a billing user can still LOG a consent or a DSAR
-- and then cannot close it, which is the gap 432 exists to remove.

DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'billing'
  AND p.name IN ('subscriber_consents.manage', 'dsar_requests.manage');
