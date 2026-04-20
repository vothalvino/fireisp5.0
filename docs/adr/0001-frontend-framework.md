# ADR 0001 — Frontend Framework Selection

**Date:** 2026-04-20  
**Status:** Accepted  
**Deciders:** FireISP core team

---

## Context

FireISP 5.0 ships a legacy vanilla-JS SPA in `/public` (56 pages registered in `js/pages.js`).
It will be **replaced**, not extended.
The new frontend must:

- Consume the 184-path REST API defined in `/docs/openapi.json`
- Support JWT authentication with silent refresh
- Enforce role-based UI routing (admin, billing, support, technician, read-only roles)
- Render ISP-operator workflows: clients, contracts, invoices, payments, tickets, devices, CFDI, SNMP dashboards
- Be maintainable by a small team with access to a large package ecosystem

## Options Considered

| | React + TypeScript | Vue 3 + TypeScript | SvelteKit |
|---|---|---|---|
| Ecosystem size | ⭐⭐⭐ Largest | ⭐⭐ Large | ⭐ Growing |
| TypeScript support | ⭐⭐⭐ First-class | ⭐⭐⭐ First-class | ⭐⭐ Good |
| Typed API client tooling | ⭐⭐⭐ openapi-typescript + openapi-fetch | ⭐⭐ Good | ⭐⭐ Good |
| Admin dashboard UI kits | ⭐⭐⭐ shadcn/ui, Ant Design, MUI | ⭐⭐ Vuetify, Quasar | ⭐ Limited |
| SSR need | ❌ Not needed (admin-only panel) | ❌ Not needed | ✅ Built-in (overkill) |
| Routing | react-router-dom v6 (mature) | vue-router (mature) | File-based (magic) |
| State/async | TanStack Query (best-in-class) | Pinia + TanStack Query | TanStack Query |
| Team familiarity risk | Low (most common) | Medium | Higher |
| Dev tooling (Vite) | ✅ Official plugin | ✅ Official plugin | ✅ Built-in |

## Decision

**React 18 + TypeScript + Vite** is selected.

Rationale:
1. **Ecosystem**: React has the largest library selection for data-heavy ISP dashboards (table components, chart libs, form validation, virtualized lists).
2. **Typed API client**: `openapi-typescript` + `openapi-fetch` give the best end-to-end type safety from OpenAPI spec → UI components without code generation boilerplate.
3. **TanStack Query**: The best solution for cache invalidation, background refetch, and optimistic updates — exactly what invoice/payment lists require.
4. **Team familiarity**: React is the most widely known framework, reducing onboarding friction.
5. **No SSR required**: The admin panel is served to authenticated ISP operators only; SEO and SSR add no value.
6. **Vite**: Fast HMR with `@vitejs/plugin-react`; dev proxy to Express API on port 3000.

## Consequences

- Frontend lives in `/frontend` (separate Vite project, not inside `src/`).
- Legacy `/public` stays in place until Milestone 2.2 feature parity, then removed.
- `openapi-typescript` generates `src/api/schema.d.ts` — regenerate with `npm run gen:api` whenever the spec changes.
- `openapi-fetch` is the typed HTTP client wrapper; wraps native `fetch`.
- `react-router-dom` v6 handles client-side routing; role guards wrap protected routes.
- `@tanstack/react-query` v5 manages server state (auth state stays in `AuthContext`).
- Build output goes to `/frontend/dist`; in production it is served by the Express server as a static asset directory alongside the legacy `/public`.
