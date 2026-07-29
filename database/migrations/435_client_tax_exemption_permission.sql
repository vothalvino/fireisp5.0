-- =============================================================================
-- 435 — a dedicated permission for setting a client's tax/IVA exemption
-- =============================================================================
-- Setting tax_exempt was gated on `clients.update`, which migration 119 grants
-- to SUPPORT as well as admin. So a support agent could flip a client to
-- IVA-exempt — and that is not a support decision: the flag changes what the
-- CFDI declares (ObjetoImp / a TipoFactor='Exento' traslado instead of a rated
-- one), so a wrongly-set exemption files an incorrect fiscal document with SAT
-- and is only correctable by cancelling and re-issuing.
--
-- `clients.update` cannot express this. It is the broad "edit a client" grant —
-- names, addresses, contacts, reseller assignment — and narrowing it to protect
-- one fiscal flag would strip support of the client editing they legitimately
-- need. Hence a separate slug.
--
-- Granted to ADMIN ONLY (operator decision, 2026-07-29). Billing was considered
-- — they own CFDI compliance day to day — and deliberately not included; add
-- them with a one-line grant if that changes.
--
-- NOTE: legacy `users.role = 'admin'` bypasses permission checks entirely
-- (src/middleware/rbac.js), so those users are unaffected either way. This
-- governs org-membership roles.
-- =============================================================================

-- Column is `module`, not `group` — permissions(id, name, description, module).
INSERT IGNORE INTO permissions (name, description, module)
VALUES (
  'clients.tax_exemption',
  'Set a client tax/IVA exemption (affects CFDI output)',
  'clients'
);

-- Admin only. An unseeded or ungranted slug is a silent 403 for everyone except
-- legacy admins, so the grant matters as much as the permission row.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name = 'clients.tax_exemption'
WHERE  r.name = 'admin';
