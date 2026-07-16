-- =============================================================================
-- Rollback 394 — Revert ticket category ENUM and the role grants
-- =============================================================================
-- Note: the free-text values normalized by step 1 of the migration are not
-- recoverable; the column reverts to VARCHAR(100) NULL keeping the enum values
-- as plain text.

ALTER TABLE tickets
  MODIFY COLUMN category VARCHAR(100) NULL
    COMMENT 'e.g. connectivity, billing, hardware';

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'tickets.view_billing'
  AND r.name IN ('admin', 'billing', 'support', 'readonly');

DELETE FROM permissions WHERE name = 'tickets.view_billing';

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'technician'
  AND p.name IN ('tickets.view', 'ticket_relations.view', 'noc.view');

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'billing'
  AND p.name = 'escalations.view';
