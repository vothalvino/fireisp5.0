-- Rollback for migration 356 — remove §21 permissions and role assignments
DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions WHERE module IN ('ai_support', 'noc_ai')
);
DELETE FROM permissions WHERE module IN ('ai_support', 'noc_ai');
