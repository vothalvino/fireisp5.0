-- =============================================================================
-- FireISP 5.0 — Rollback 171: Remove AI Reply Assistant permissions
-- =============================================================================
-- Reverses migration 171.  Removes the eight exact ai.* permission slugs the
-- migration seeded and any role_permissions rows referencing them.  Other
-- permissions in the 'ai' module (if any were created elsewhere) are left
-- untouched.
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'ai'
  AND p.name IN (
    'ai.policy.read',
    'ai.policy.write',
    'ai.providers.read',
    'ai.providers.write',
    'ai.phrases.read',
    'ai.phrases.write',
    'ai.reply.draft',
    'ai.reply.send'
  );

DELETE FROM permissions
WHERE module = 'ai'
  AND name IN (
    'ai.policy.read',
    'ai.policy.write',
    'ai.providers.read',
    'ai.providers.write',
    'ai.phrases.read',
    'ai.phrases.write',
    'ai.reply.draft',
    'ai.reply.send'
  );
