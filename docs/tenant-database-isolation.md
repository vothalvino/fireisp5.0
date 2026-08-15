# Per-tenant database isolation

FireISP defaults to a shared database with strict `organization_id` scoping. For high-value tenants that require physical data separation, enable isolated mode per organization.

## Enable isolated mode

1. Schedule a write freeze or maintenance window for the tenant. Isolation is
   a data cutover, not only a connection-setting change.
2. Create an empty MySQL/MariaDB database and user for the tenant.
3. Run migrations against the primary control-plane database:
   ```bash
   npm run migrate
   ```
4. While the organization still uses shared mode, apply the complete FireISP
   schema directly to the candidate tenant database using that database's
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and secret-injected
   `DB_PASSWORD`. Do not point the application at the tenant database yet.
5. Copy the organization's tenant-owned data into the candidate database with
   a reviewed migration plan. This repository does not currently provide an
   automatic live-tenant copy command. At minimum, validate the organization,
   NAS, RADIUS account, client, contract, IP-assignment, session, and dependent
   records needed by the enabled modules; preserve identifiers and foreign-key
   order. For an existing connection logger this includes `connection_logs`,
   `radius_accounting_events`, `radius_accounting_usage_daily`, collector
   receipts, and—when enabled—the CGNAT exporter configuration, tuple locks,
   binding projection/events, same-organization government-request cases, and
   `ip_attribution_case_evidence`. Preserve active scoped holds and their linked
   evidence as one unit. An empty schema is not a usable isolated tenant.
6. Test the candidate settings without saving them by sending the same payload
   to the test endpoint:
   ```http
   POST /api/v1/organizations/{organizationId}/database-isolation/test
   ```
7. Reconcile row counts and ownership, then configure the tenant database
   through the admin API. This `PUT` is the routing cutover and must happen only
   after the schema and data checks pass:
   ```http
   PUT /api/v1/organizations/{organizationId}/database-isolation
   {
     "isolation_mode": "isolated",
     "db_host": "tenant-db.internal",
     "db_port": 3306,
     "db_name": "fireisp_org_123",
     "db_user": "fireisp_org_123",
     "db_password": "replace-with-secret",
     "ssl_enabled": true
   }
   ```
8. Run migrations across every now-enabled isolated database and perform
   tenant-scoped read/write acceptance checks before ending the write freeze:
   ```bash
   MIGRATE_ISOLATED_TENANTS=true npm run migrate
   ```

   For connection logging, the acceptance check must resolve an active NAS and
   subscriber in the isolated database, ingest a Start/Interim/Stop lifecycle
   through the tenant API, read it back in that organization, and confirm the
   same username/private address in another organization is neither read nor
   modified.

When an authenticated request passes through `orgScope`, database queries for an isolated organization are routed to that tenant's configured pool. Organizations without an isolated config continue using the shared pool.

Enabling isolated mode before copying data immediately routes tenant reads to
the candidate database. If it contains only schema, NAS resolution and normal
application reads will fail or appear empty. Do not use the configuration
switch as a data-migration mechanism.

## Disable isolated mode

Switch the organization back to the shared database:

```http
PUT /api/v1/organizations/{organizationId}/database-isolation
{
  "isolation_mode": "shared"
}
```

This clears connection fields from the control-plane config and invalidates the cached tenant pool. It does **not** migrate tenant data back to the shared database; run an explicit data migration before disabling isolation for a live tenant.

## Operational notes

- Store `ENCRYPTION_KEY` in production so tenant database passwords are encrypted at rest.
- Back up isolated tenant databases separately from the shared control-plane database.
- Apply migrations with `MIGRATE_ISOLATED_TENANTS=true` during every release after the control-plane migration succeeds.
- Rehearse schema-changing migrations and rollbacks on the deployment's real
  MySQL version and representative table sizes. Migration 457 alters a
  partitioned table; pause/drain all accounting writers, verify collector
  retry/queue behavior, then use a maintenance window, verified backups,
  metadata-lock and replication monitoring, and the isolated-aware rollback
  dry-run. Apply it to the primary and all active isolated databases before
  confirming the new ownership/evidence triggers and resuming writers. MySQL
  cannot make the table alteration and trigger installation atomic. Its
  rollback drops post-migration evidence/usage/CGNAT-attribution data and
  restores a legacy
  fixed-two-year partition drop, so prefer a forward repair when possible.
  If rollback 457 is unavoidable, dry-run and execute the explicit boundary
  `MIGRATE_ISOLATED_TENANTS=true pnpm rollback -- --to 456`; never assume
  `--step 1` identifies the same migration in histories that may have drifted.
- Keep one database per isolated tenant; do not share an isolated database between organizations.
- Point an isolated tenant's external FreeRADIUS instance at that tenant database
  for authorization, and send accounting to
  `POST /api/v1/radius/accounting/tenant` with an API token owned by that
  organization and scoped to `connection_logs:ingest`. This explicit tenant
  context remains safe when Global and isolated organizations reuse the same
  username or RFC1918 NAS address. The install-wide shared-secret accounting
  endpoint can only accept a NAS address that is unique across every database.
  The API token must contain exactly that one scope, and its active owner must
  have `connection_logs.ingest`; JWT, wildcard, write, or multi-scope tokens are
  not accounting collector credentials.
- If privacy-minimal CGNAT attribution is approved, give the external binding
  normalizer a separate organization token whose only scope is
  `cgnat_attribution:ingest` and whose owner has
  `cgnat_attribution.ingest`. Preserve the canonical `session_instance_id`
  returned by that tenant's RADIUS accounting ingest and require it on every
  allocate/release; never correlate across databases by a private address or
  optional subscriber hint. Never share one token between the session and
  CGNAT collectors, and never send destinations or content.
- Connection-log reads, exports, readiness and retention use the isolated
  tenant context. This includes the mutable session projection, selected
  lifecycle evidence, operational UTC usage rollup, and CGNAT bindings.
  Verify all four operations after each migration; applying the control-plane
  schema alone does not create these tables in the isolated database.
- The embedded UDP RADIUS listener can route an isolated NAS only when its
  observed source address identifies exactly one active NAS across the install.
  Reused/ambiguous source addresses fail closed; use a distinct public or
  WireGuard source address, or tenant-local external FreeRADIUS.
