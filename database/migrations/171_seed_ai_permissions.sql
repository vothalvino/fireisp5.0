-- Migration: 171_seed_ai_permissions
-- Description: Seeds the RBAC permissions required by the AI Reply Assistant
--              (§5.1 permission map) and assigns them to the `admin` role only.
--
--              Eight granular `ai.*` slugs are added — one for each gate in
--              src/routes/ai.js.  No other role receives these permissions by
--              default; operators can grant them through the UI if needed.
--
--              Uses INSERT IGNORE throughout so re-running on an existing
--              installation is safe.

-- -------------------------------------------------------------------------
-- 1.  New permissions (module = 'ai')
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('ai.policy.read',     'View AI assistant policy, audit logs, and metrics',  'ai'),
    ('ai.policy.write',    'Configure AI assistant policy and master on/off switch', 'ai'),
    ('ai.providers.read',  'View registered AI LLM providers (no API keys returned)', 'ai'),
    ('ai.providers.write', 'Register, edit, delete, and test-connect AI providers',   'ai'),
    ('ai.phrases.read',    'View phrase library and forbidden-term list',              'ai'),
    ('ai.phrases.write',   'Edit phrase library and forbidden-term list',              'ai'),
    ('ai.reply.draft',     'Force-generate an AI draft reply for a support ticket',   'ai'),
    ('ai.reply.send',      'Send, edit, or discard an AI-generated reply draft',      'ai');

-- -------------------------------------------------------------------------
-- 2.  Assign ALL ai.* permissions to the admin role only
-- -------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name LIKE 'ai.%'
WHERE  r.name = 'admin';
