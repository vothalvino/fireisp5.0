-- =============================================================================
-- Rollback 289: Rate Limiting RBAC permissions seed — §10.2
-- =============================================================================

DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'rate_limit_templates.view','rate_limit_templates.create',
    'rate_limit_templates.update','rate_limit_templates.delete',
    'protocol_shaping_rules.view','protocol_shaping_rules.create',
    'protocol_shaping_rules.update','protocol_shaping_rules.delete'
  )
);

DELETE FROM permissions WHERE name IN (
  'rate_limit_templates.view','rate_limit_templates.create',
  'rate_limit_templates.update','rate_limit_templates.delete',
  'protocol_shaping_rules.view','protocol_shaping_rules.create',
  'protocol_shaping_rules.update','protocol_shaping_rules.delete'
);
