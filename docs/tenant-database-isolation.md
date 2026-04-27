# Per-tenant database isolation

FireISP defaults to a shared database with strict `organization_id` scoping. For high-value tenants that require physical data separation, enable isolated mode per organization.

## Enable isolated mode

1. Create an empty MySQL/MariaDB database and user for the tenant.
2. Run migrations against the primary control-plane database:
   ```bash
   npm run migrate
   ```
3. Configure the tenant database through the admin API:
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
4. Verify connectivity:
   ```http
   POST /api/v1/organizations/{organizationId}/database-isolation/test
   ```
5. Apply the FireISP schema to all enabled isolated tenant databases:
   ```bash
   MIGRATE_ISOLATED_TENANTS=true npm run migrate
   ```

When an authenticated request passes through `orgScope`, database queries for an isolated organization are routed to that tenant's configured pool. Organizations without an isolated config continue using the shared pool.

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
- Keep one database per isolated tenant; do not share an isolated database between organizations.
