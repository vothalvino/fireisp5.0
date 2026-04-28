# Video Walkthrough — Data Migration Flow

**Companion runbook:** [`docs/data-migration.md`](../data-migration.md)  
**Video asset:** [`data-migration-walkthrough.svg`](data-migration-walkthrough.svg)

## Audience

Operators migrating an existing ISP operation from a legacy billing system, spreadsheet workflow, or another ISP platform into FireISP 5.0.

## Key message

Run a staged, backup-first migration: prepare the tenant, import CSV resources in dependency order, verify counts and balances, and keep rollback ready until production sign-off.

## Storyboard and narration

### 1. Goal and safety guardrails

Narration:

> This walkthrough shows the production-safe FireISP data migration flow. Before any import, confirm that FireISP is installed, database migrations are applied, an organization exists, and an admin user can authenticate.

On-screen checklist:

- FireISP 5.0 installed
- Database migrations applied
- Organization and admin user created
- Plans and sites prepared
- Production backup taken

### 2. Prepare source CSV files

Narration:

> Export each legacy dataset as UTF-8 CSV. Normalize dates to `YYYY-MM-DD`, validate required columns, and split files larger than 10 MiB or 10,000 rows.

On-screen checklist:

- `clients.csv`
- `devices.csv`
- `contracts.csv`
- `invoices.csv`
- `payments.csv`
- UTF-8 encoding
- Dates normalized to `YYYY-MM-DD`
- Files split below 10 MiB and 10,000 rows

### 3. Import in dependency order

Narration:

> Import resources in the order required by foreign-key dependencies: clients first, then devices, contracts, invoices, and payments. Use the upload endpoints with the same bearer token and `X-Org-Id` header.

On-screen command:

```bash
curl -X POST http://localhost:3000/api/import/clients/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-Org-Id: <org_id>" \
  -F "file=@clients.csv"
```

### 4. Resolve row-level errors

Narration:

> Import endpoints report row-level errors without aborting the entire batch. Review the response, correct only the failed rows in the source file, and re-run those rows after confirming they will not duplicate successful imports.

On-screen response:

```json
{
  "imported": 150,
  "total": 152,
  "errors": [
    { "row": 23, "error": "first_name and last_name are required" }
  ]
}
```

### 5. Verify production data

Narration:

> After the imports complete, compare FireISP row counts and financial totals against the source system. Confirm there are no orphaned contracts or invoice-payment links, then spot-check known customers from the dashboard or API.

On-screen checklist:

- Row counts match source
- Total invoiced and total paid match source
- No orphaned contracts
- No orphaned invoice-payment links
- Known customers spot-checked

### 6. Rollback readiness and sign-off

Narration:

> Keep the pre-migration backup until business sign-off is complete. If the migration must be reverted, restore the backup, verify row counts, and re-enable the MySQL event scheduler.

On-screen content:

- Backup filename recorded
- Restore command documented
- Event scheduler re-enabled after restore
- Production sign-off captured
