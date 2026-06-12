-- =============================================================================
-- Rollback 296: Remove portal self-service RBAC permissions
-- =============================================================================

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'portal_kb.view','portal_kb.create','portal_kb.update','portal_kb.delete',
    'portal_service_requests.view','portal_service_requests.update',
    'portal_push.view','portal_push.manage'
  )
);

DELETE FROM permissions
WHERE name IN (
  'portal_kb.view','portal_kb.create','portal_kb.update','portal_kb.delete',
  'portal_service_requests.view','portal_service_requests.update',
  'portal_push.view','portal_push.manage'
);
