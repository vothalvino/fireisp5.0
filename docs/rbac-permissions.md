# FireISP 5.0 — RBAC Permission Matrix

> Extracted from `database/migrations/119_seed_default_roles_and_permissions.sql`.
>
> FireISP uses dot-notation permission slugs (`module.action`) enforced via `requirePermission()` middleware on API routes.

## System Roles

| Role | Description | Scope |
|------|-------------|-------|
| **admin** | Full system access — all resources and settings | All permissions |
| **billing** | Billing module — invoices, payments, plans, subscriptions | Billing + read-only clients/contracts |
| **support** | Support access — clients, tickets, communications | Clients + tickets + read-only contracts |
| **technician** | Field / NOC tech — devices, jobs, network, inventory | Network + jobs + inventory |
| **readonly** | Read-only observer — view all resources, cannot modify | All `*.view` and `*.export` |

All roles are flagged `is_system = TRUE` and cannot be deleted through the UI.

## Permission Slugs

| Module | Permission Slug | Description |
|--------|----------------|-------------|
| **clients** | `clients.view` | View client list and profiles |
| | `clients.create` | Create new clients |
| | `clients.update` | Edit existing client records |
| | `clients.delete` | Delete or deactivate clients |
| **contracts** | `contracts.view` | View service contracts |
| | `contracts.create` | Create new service contracts |
| | `contracts.update` | Modify existing contracts |
| | `contracts.delete` | Cancel or delete contracts |
| **invoices** | `invoices.view` | View invoices |
| | `invoices.create` | Generate new invoices |
| | `invoices.update` | Edit draft invoices |
| | `invoices.delete` | Void or delete invoices |
| **payments** | `payments.view` | View payment records |
| | `payments.create` | Record new payments |
| | `payments.update` | Edit payment records |
| | `payments.delete` | Delete payment records |
| **tickets** | `tickets.view` | View support tickets |
| | `tickets.create` | Open new support tickets |
| | `tickets.update` | Update and respond to tickets |
| | `tickets.delete` | Delete tickets |
| **devices** | `devices.view` | View network devices |
| | `devices.create` | Add new devices |
| | `devices.update` | Edit device configuration |
| | `devices.delete` | Remove devices |
| **plans** | `plans.view` | View service plans |
| | `plans.create` | Create new service plans |
| | `plans.update` | Edit existing plans |
| | `plans.delete` | Delete plans |
| **jobs** | `jobs.view` | View work orders |
| | `jobs.create` | Create new work orders |
| | `jobs.update` | Update work orders |
| | `jobs.delete` | Delete work orders |
| **expenses** | `expenses.view` | View expense records |
| | `expenses.create` | Submit new expenses |
| | `expenses.update` | Edit expense records |
| | `expenses.approve` | Approve or reject submitted expenses |
| **reports** | `reports.view` | Access reports and dashboards |
| | `reports.export` | Export report data |
| **settings** | `settings.view` | View application settings |
| | `settings.update` | Modify application settings |
| **users** | `users.view` | View user accounts |
| | `users.create` | Create new user accounts |
| | `users.update` | Edit user accounts |
| | `users.delete` | Delete or deactivate user accounts |
| **inventory** | `inventory.view` | View inventory items and stock |
| | `inventory.create` | Add inventory items |
| | `inventory.update` | Edit inventory items |
| | `inventory.transfer` | Transfer stock between warehouses |
| **network** | `network.view` | View network topology and resources |
| | `network.create` | Add network resources (NAS, IP pools) |
| | `network.update` | Edit network resources |
| | `network.delete` | Remove network resources |
| **audit** | `audit_logs.view` | View the audit log |
| **organizations** | `organizations.view` | View organization profile |
| | `organizations.update` | Edit organization settings |

## Role → Permission Matrix

| Permission | admin | billing | support | technician | readonly |
|------------|:-----:|:-------:|:-------:|:----------:|:--------:|
| `clients.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `clients.create` | ✓ | | ✓ | | |
| `clients.update` | ✓ | | ✓ | | |
| `clients.delete` | ✓ | | | | |
| `contracts.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contracts.create` | ✓ | | | | |
| `contracts.update` | ✓ | | | | |
| `contracts.delete` | ✓ | | | | |
| `invoices.view` | ✓ | ✓ | | | ✓ |
| `invoices.create` | ✓ | ✓ | | | |
| `invoices.update` | ✓ | ✓ | | | |
| `invoices.delete` | ✓ | ✓ | | | |
| `payments.view` | ✓ | ✓ | | | ✓ |
| `payments.create` | ✓ | ✓ | | | |
| `payments.update` | ✓ | ✓ | | | |
| `payments.delete` | ✓ | ✓ | | | |
| `tickets.view` | ✓ | | ✓ | | ✓ |
| `tickets.create` | ✓ | | ✓ | | |
| `tickets.update` | ✓ | | ✓ | | |
| `tickets.delete` | ✓ | | ✓ | | |
| `devices.view` | ✓ | | | ✓ | ✓ |
| `devices.create` | ✓ | | | ✓ | |
| `devices.update` | ✓ | | | ✓ | |
| `devices.delete` | ✓ | | | ✓ | |
| `plans.view` | ✓ | ✓ | | | ✓ |
| `plans.create` | ✓ | ✓ | | | |
| `plans.update` | ✓ | ✓ | | | |
| `plans.delete` | ✓ | ✓ | | | |
| `jobs.view` | ✓ | | | ✓ | ✓ |
| `jobs.create` | ✓ | | | ✓ | |
| `jobs.update` | ✓ | | | ✓ | |
| `jobs.delete` | ✓ | | | ✓ | |
| `expenses.view` | ✓ | ✓ | | ✓ | ✓ |
| `expenses.create` | ✓ | | | ✓ | |
| `expenses.update` | ✓ | | | | |
| `expenses.approve` | ✓ | ✓ | | | |
| `reports.view` | ✓ | ✓ | ✓ | | ✓ |
| `reports.export` | ✓ | ✓ | | | ✓ |
| `settings.view` | ✓ | ✓ | | | ✓ |
| `settings.update` | ✓ | | | | |
| `users.view` | ✓ | | | | ✓ |
| `users.create` | ✓ | | | | |
| `users.update` | ✓ | | | | |
| `users.delete` | ✓ | | | | |
| `inventory.view` | ✓ | | | ✓ | ✓ |
| `inventory.create` | ✓ | | | ✓ | |
| `inventory.update` | ✓ | | | ✓ | |
| `inventory.transfer` | ✓ | | | ✓ | |
| `network.view` | ✓ | | | ✓ | ✓ |
| `network.create` | ✓ | | | ✓ | |
| `network.update` | ✓ | | | ✓ | |
| `network.delete` | ✓ | | | ✓ | |
| `audit_logs.view` | ✓ | | | | ✓ |
| `organizations.view` | ✓ | | | | ✓ |
| `organizations.update` | ✓ | | | | |

## Route Authorization

Routes without RBAC middleware (by design):

| Route | Reason |
|-------|--------|
| `auth.js` | Public endpoints (login, register, password reset) |
| `events.js` | SSE stream — authentication only, no permission needed |
| `metrics.js` | Internal Prometheus metrics endpoint |
| `paymentWebhooks.js` | Authenticated via HMAC signature (Stripe/Conekta) |
| `pdf.js` | Authentication only — users download their own documents |
| `twoFactor.js` | User self-service (own account only) |

All other 63 route files enforce RBAC via `requirePermission('module.action')`.
