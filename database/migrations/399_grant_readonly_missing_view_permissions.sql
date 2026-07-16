-- =============================================================================
-- Migration 399: Grant readonly the view-only permissions it never got
-- =============================================================================
-- NUMBERING NOTE: migration 398 is being authored concurrently in a sibling
-- PR (SNMP work) and had not merged when this one was written. This file is
-- deliberately numbered 399 (next free number at authoring time) rather than
-- reusing 398 — rebase onto 398 once that PR merges. Until then CI's
-- migration-numbering/README-sync check may flag the temporary gap; that is
-- expected pre-rebase state, not a defect in this migration.
--
-- Root cause: role 'readonly' is meant to "see everything, change nothing"
-- (CLAUDE.md persona contract) but two frontend bugs (fixed alongside this
-- migration — see PrivateRoute.tsx) made every requiredRole-gated page
-- unreachable for it regardless of backend grants. Fixing the frontend gate
-- exposed the *real*, pre-existing gap this migration closes: migration 119's
-- readonly grant was a one-time `INSERT...SELECT ... LIKE '%.view'` snapshot
-- over the ~17 permissions that existed at that moment — every `.view`
-- permission added by a later migration needed its own explicit grant, and
-- most per-module migrations after 119 (194, 197, 199, ..., 377, 393, 394)
-- remembered to add one for readonly, but three whole modules never did:
-- §18 automation (343), §19 resellers (347), §20 integrations (350) — all
-- granted only to admin/noc_operator/super_admin. A handful of individual
-- pages elsewhere were also missed one-off (pppoe diagnostics, CPE profiles,
-- tax report export, DSAR requests, the AI Assistant policy tab, AI support
-- conversations).
--
-- This migration was produced by a full audit of every page behind a
-- technician/billing/admin PrivateRoute guard in frontend/src/App.tsx: for
-- each page, every GET endpoint it fires on initial load was traced to its
-- `requirePermission(...)` slug in src/routes/*.js, then checked against the
-- complete grant history (every migration that has ever granted role
-- 'readonly' anything). See the PR description for the full page -> endpoint
-- -> slug -> previously-missing? table.
--
-- All 17 slugs below are dedicated, single-purpose `.view`/`.read` slugs
-- verified (by reading the route file) to gate ONLY a GET handler in their
-- module — never reused for a POST/PUT/DELETE — so granting them cannot let
-- readonly perform a write. Idempotent (WHERE NOT EXISTS), matching the
-- established grant-migration pattern (see 298, 377, 393, 394).
--
-- Deliberately NOT granted here (existing, reasoned exclusions this
-- migration preserves rather than overrides — flagged in the PR for
-- explicit product-owner review since they read as a partial exception to
-- "sees everything"):
--   * Credential-bearing modules excluded by migration 377's own stated
--     policy ("readonly, auditor — every *.view/*.export EXCEPT
--     credential-bearing modules"): api_tokens.view, webhooks.view,
--     device_config_backups.view, payment_gateways.view, pac_providers.view,
--     csd_certificates.view.
--   * The entire §17 Security & Access Control module, deliberately left
--     empty for readonly by migration 335 ("principle of least privilege —
--     security data is sensitive"): webauthn.view, admin_ip_allowlist.view,
--     password_policy.view, api_key_rate_limits.view, firewall_rules.view,
--     ddos_protection.view, blackhole_routes.view, dns_blocklists.view,
--     cpe_security_scans.view, encryption_keys.view, data_masking.view,
--     secure_deletion.view.
--   * wireguard.peers.admin (org-wide WireGuard peer oversight, gates the
--     GET /wg-peers/admin/all list AND the DELETE/rotate admin actions under
--     one slug — migration 365/393 already deliberately gave readonly only
--     the narrow self-service wireguard.peers.view, not this one, precisely
--     because it has no separate view-only variant).
--   * Reseller sub-resource permissions with no dedicated view slug
--     (reseller_plan_prices.manage, reseller_commissions.approve,
--     reseller_billing_entities.manage, reseller_ip_pool_allocations.manage,
--     reseller_bandwidth_quotas.manage) — each conflates view+mutate under
--     one slug, same reasoning as wireguard.peers.admin.
-- These pages will still show their nav row to readonly (the frontend fix
-- makes canSee() skip the roles[] allowlist for readonly) but will 403 on
-- load — a "visible but forbidden" page-load 403 rather than the crash
-- CLAUDE.md warns about, and consistent with this repo's existing norm that
-- the frontend does not gate UI by permission. Follow-up PRs can revisit
-- these exceptions if product wants a stricter "truly everything" reading.
-- =============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'pppoe.diagnostics',
  'cpe_profiles.view',
  'billing.tax_reports',
  'dsar_requests.view',
  'ai.policy.read',
  'automation_rules.view',
  'batch_jobs.view',
  'provisioning_pipelines.view',
  'remediation_rules.view',
  'automation_scripts.view',
  'script_executions.view',
  'router_driver_configs.view',
  'resellers.view',
  'integration_providers.view',
  'integration_connections.view',
  'integration_sync_logs.view',
  'support.conversations.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
