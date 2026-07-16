# Faro nav registry (PR #421, 2026-07-16)

The sidebar is registry-driven. `frontend/src/nav/routes.ts` declares every
staff route once: `{ path, labelKey, section, guard, sub?, card?, rail?,
roles?, requiredLocale? }`. `Layout.tsx` + `NavSection.tsx` render the
9-section accordion from it; `HubPage.tsx` renders the `/billing`, `/network`,
`/admin` card grids from it. The old `NAV_GROUPS` / `TECHNICIAN_NAV_GROUPS`
fork is gone.

## Adding a route now means

1. Route it in `App.tsx` under the correct `PrivateRoute` wrapper.
2. Add ONE registry entry whose `guard` mirrors that wrapper ('any' |
   'technician' | 'billing' | 'admin') and give it `rail: true` (daily-work
   shortlist) and/or a `card` (hub page). `navRegistry.test.ts` fails CI on:
   missing/duplicate registry entry, guard mismatch, unreachable entry
   (neither rail nor card), or missing i18n in any of en/es/pt-BR.
3. `roles` is an **audited allowlist**, not a rank: list only roles whose
   `role_permissions` seeds actually let the page load — a visible row must
   never 403. Omitted `roles` = any authenticated role (guard still applies).
   `canSee()` order: locale → admin bypass → guard via `hasRole` → readonly
   bypass → allowlist. Gotchas: `roles: []` ≠ omitted (empty = admin-only);
   billing passes 'technician' guards via the rank tie, so technician-only
   items need explicit `roles: ['technician']`; readonly's actual slug is
   `'readonly'` and it fails every non-'any' guard (ROLE_RANK has no entry).
4. Update `navPersonas.test.ts` — it locks each persona's resolved nav to the
   permission audit.

## Audit facts baked into current allowlists (re-verify before changing)

- technician LACKS: tickets.view (119), leads.view (194), surveys.view (197),
  noc.view (298), cpe_profiles.view (276).
- billing LACKS: tickets.view, escalations.view (197), devices.view.
- support LACKS devices.view/sites.view/plans.view but HAS outages.view,
  network_health.view (377), work_orders.* (298) — that's why /outages and
  /network-health live in the any-auth App.tsx block.
- Migration 393 granted wireguard.peers.view/create/delete → billing and
  .view → readonly (365 had skipped them while the row rendered for all).

## Not built yet (PR-3 of the design spec)

Ctrl+K command palette over the registry, admin workspace presets, scoped
count badges. Design spec + per-persona tables live in the session artifact
(see chat history 2026-07-15) — the registry was built to feed the palette
with zero extra data.
