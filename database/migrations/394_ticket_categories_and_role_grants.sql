-- =============================================================================
-- Migration 394 — Ticket categories become a required taxonomy + role grants
-- =============================================================================
-- tickets.category was a nullable free-text VARCHAR ("e.g. connectivity,
-- billing, hardware") that nothing enforced. It becomes a 4-value ENUM
-- (technical / billing / installation / general), NOT NULL with DEFAULT
-- 'general' so every existing insert path (portal, AI support, alerts,
-- conversations) keeps working; the staff create endpoint additionally
-- REQUIRES an explicit category via its validation schema.
--
-- The taxonomy exists so ticket visibility can be scoped by role: a new
-- permission `tickets.view_billing` gates billing-category tickets. Roles
-- holding it (admin/billing/support/readonly) see everything; roles without
-- it (technician) see every ticket EXCEPT billing ones — enforced in
-- src/routes/tickets.js on list, stats, detail and every /:id subresource.
--
-- Role grants in this migration:
--   technician — tickets.view + ticket_relations.view (can now open the
--                Tickets page; time-logs/attachments perms already granted in
--                298/300) and noc.view (NOC dashboard)
--   billing    — escalations.view (Escalations list/detail)
--   admin/billing/support/readonly — tickets.view_billing
-- =============================================================================

-- 1) Normalize legacy free-text values into the new taxonomy ------------------
UPDATE tickets SET category = CASE
  WHEN category IS NULL OR TRIM(category) = ''                    THEN 'general'
  WHEN LOWER(TRIM(category)) IN ('billing','facturacion','facturación','pagos','payments','payment','cobranza') THEN 'billing'
  WHEN LOWER(TRIM(category)) IN ('installation','instalacion','instalación','install') THEN 'installation'
  WHEN LOWER(TRIM(category)) IN ('technical','connectivity','hardware','network','outage','internet','wifi','signal','señal','velocidad','speed') THEN 'technical'
  ELSE 'general'
END;

-- 2) Constrain the column (guarded via INFORMATION_SCHEMA — idempotent) -------
DROP PROCEDURE IF EXISTS migration_394_ticket_category_enum;
DELIMITER //
CREATE PROCEDURE migration_394_ticket_category_enum()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tickets'
      AND COLUMN_NAME  = 'category'
      AND DATA_TYPE   <> 'enum'
  ) THEN
    ALTER TABLE tickets
      MODIFY COLUMN category ENUM('technical','billing','installation','general')
        NOT NULL DEFAULT 'general'
        COMMENT 'Ticket taxonomy; billing-category tickets are gated by tickets.view_billing (migration 394)';
  END IF;
END //
DELIMITER ;
CALL migration_394_ticket_category_enum();
DROP PROCEDURE IF EXISTS migration_394_ticket_category_enum;

-- 3) New permission: view billing-category tickets ----------------------------
INSERT INTO permissions (name, description, module)
SELECT 'tickets.view_billing', 'View billing-category tickets (roles without it see all other categories)', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tickets.view_billing');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'tickets.view_billing'
WHERE r.name IN ('admin', 'billing', 'support', 'readonly');

-- 4) Technician: open the Tickets page + relations panel + NOC dashboard ------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('tickets.view', 'ticket_relations.view', 'noc.view')
WHERE r.name = 'technician';

-- 5) Billing: escalations access ----------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'escalations.view'
WHERE r.name = 'billing';
