-- =============================================================================
-- Migration 383: Seed radius.credentials.view permission
-- =============================================================================
-- GET /radius, GET /radius/:id, and GET /radius/contract/:contractId used to
-- return the full `radius` row — including the cleartext PPPoE `password`
-- column — gated only by `devices.view`. Because migration 119 grants
-- `readonly` every `*.view`/`*.export` permission by wildcard, that pure
-- view-only/auditor persona was getting cleartext subscriber passwords for
-- every account in the org.
--
-- This migration does NOT touch `devices.view` grants (those already control
-- the base, password-stripped RADIUS account views for everyone who has them
-- today). It seeds a new, finer-grained slug that gates ONLY the new
-- credentials-bearing endpoints (GET /radius/contract/:contractId/credentials
-- and GET /radius/:id/credentials — see src/routes/radius.js), which return
-- the full row including `password`. This lets a role that lacks
-- `devices.view` entirely (e.g. `support`) be granted cleartext-credential
-- access without also broadening its device-management surface.
--
-- Grant matrix — who provisions routers/modems and legitimately needs the
-- cleartext PPPoE username+password:
--   admin         — explicit grant for defense-in-depth. Legacy
--                   `users.role = 'admin'` already bypasses RBAC entirely
--                   (src/middleware/rbac.js), but an org-membership role
--                   named 'admin' without that legacy flag still needs this
--                   row to pass the permission check.
--   super_admin   — full system access including security settings
--                   (migration 335); not covered by the legacy admin bypass
--                   (that only checks `users.role`), so it needs the same
--                   explicit-grant treatment as its other permissions.
--   technician    — already has `devices.view`; this adds the
--                   finer-grained credentials slug on top, per the user's
--                   hard requirement that technicians keep seeing PPPoE
--                   credentials for router/CPE provisioning.
--   support       — per the user's hard requirement (support programs
--                   routers/modems too). NOTE: `support` still has no
--                   `devices.view` grant (migration 119) and this migration
--                   intentionally does not add one — the credentials routes
--                   are gated ONLY by `radius.credentials.view`, so support
--                   reaches them without gaining broader device access.
--   noc_operator  — network monitoring, device management, and incident
--                   response (migration 335) plausibly needs credentials to
--                   resolve PPPoE auth incidents.
--   manager       — included per the user's persona list for forward
--                   compatibility. This is currently a guaranteed NO-OP: no
--                   `roles` table row named 'manager' exists (only
--                   admin/billing/support/technician/readonly/super_admin/
--                   noc_operator/reseller_admin/auditor do — see migrations
--                   119/335). A future migration that introduces a 'manager'
--                   role row will need to grant this slug explicitly too;
--                   this INSERT does not retroactively do that.
--   billing       — NOT granted. Billing has never had `devices.view`
--                   (migration 119) and has no router/CPE provisioning duty.
--   readonly,
--   auditor       — NOT granted. This is the bug being fixed: these are
--                   pure view-only/auditor personas and should not hold
--                   credential-bearing access. Joins the existing
--                   credential-module carve-out convention established by
--                   migration 377 (readonly/auditor get every `*.view`
--                   EXCEPT named credential-bearing modules like
--                   api_tokens, webhooks, device_config_backups,
--                   payment_gateways, pac_providers, csd_certificates).
--   reseller_admin — NOT granted, matching migration 377's stated
--                   convention: reseller surface uses its own scoped
--                   routes; grant explicitly when needed. reseller_admin
--                   has no physical NAS/CPE provisioning role.
--
-- Tables: permissions (new row), role_permissions (grants only) — data-only
-- DML, no DDL, so there is no database/schema.sql mirror for this migration.
-- =============================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('radius.credentials.view', 'View cleartext PPPoE/RADIUS credentials (username+password) for provisioning routers/modems', 'radius');

-- ---------------------------------------------------------------------------
-- 2. Grants
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'radius.credentials.view'
WHERE r.name IN ('admin', 'super_admin', 'technician', 'support', 'noc_operator', 'manager');
