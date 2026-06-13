-- =============================================================================
-- Migration 356 — §21 AI Customer Support: seed permissions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §21 ai_support permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'support.conversations.view', 'View AI support conversations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.conversations.view');

INSERT INTO permissions (name, description, module)
SELECT 'support.conversations.create', 'Create AI support conversations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.conversations.create');

INSERT INTO permissions (name, description, module)
SELECT 'support.conversations.respond', 'Send messages in AI support conversations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.conversations.respond');

INSERT INTO permissions (name, description, module)
SELECT 'support.conversations.escalate', 'Escalate AI support conversations to human agents', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.conversations.escalate');

INSERT INTO permissions (name, description, module)
SELECT 'support.conversations.delete', 'Delete AI support conversations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.conversations.delete');

INSERT INTO permissions (name, description, module)
SELECT 'support.diagnostics.run', 'Run AI network diagnostics for a client', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.diagnostics.run');

INSERT INTO permissions (name, description, module)
SELECT 'support.kb.view', 'View knowledge base articles', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.kb.view');

INSERT INTO permissions (name, description, module)
SELECT 'support.kb.manage', 'Create, update, and delete knowledge base articles', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.kb.manage');

INSERT INTO permissions (name, description, module)
SELECT 'support.kb.feedback', 'Submit feedback on knowledge base articles', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.kb.feedback');

INSERT INTO permissions (name, description, module)
SELECT 'support.channels.view', 'View AI support channel configurations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.channels.view');

INSERT INTO permissions (name, description, module)
SELECT 'support.channels.manage', 'Manage AI support channel configurations', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.channels.manage');

INSERT INTO permissions (name, description, module)
SELECT 'support.metrics.view', 'View AI support performance metrics', 'ai_support'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'support.metrics.view');

-- ---------------------------------------------------------------------------
-- §21.7 noc_ai permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'noc_ai.read', 'Read NOC AI insights and explanations', 'noc_ai'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'noc_ai.read');

INSERT INTO permissions (name, description, module)
SELECT 'noc_ai.analyze', 'Trigger NOC AI analysis and generate insights', 'noc_ai'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'noc_ai.analyze');

-- ---------------------------------------------------------------------------
-- Grant all §21 permissions to admin and super_admin
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'support.conversations.view',
  'support.conversations.create',
  'support.conversations.respond',
  'support.conversations.escalate',
  'support.conversations.delete',
  'support.diagnostics.run',
  'support.kb.view',
  'support.kb.manage',
  'support.kb.feedback',
  'support.channels.view',
  'support.channels.manage',
  'support.metrics.view',
  'noc_ai.read',
  'noc_ai.analyze'
)
WHERE r.name IN ('admin', 'super_admin');

-- ---------------------------------------------------------------------------
-- Grant noc_ai.* to tech_support role (if it exists)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('noc_ai.read', 'noc_ai.analyze')
WHERE r.name = 'tech_support';
