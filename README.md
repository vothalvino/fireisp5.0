# FireISP 5.0

An open source ISP (Internet Service Provider) management software designed to help ISPs manage their customers, plans, billing, and network infrastructure.

## Features

- Customer management
- Service plan management
- Billing and invoicing
- Network device monitoring
- User and role management
- IP address management (IPAM) with IPv4, IPv6, and dual-stack support
- Audit logging and notifications

## Project Structure

```
fireisp5.0/
├── database/                # Database schema and migrations
│   ├── schema.sql           # Combined schema (all tables)
│   └── migrations/          # Individual numbered migration files
├── src/                     # Application source code
│   ├── config/              # App configuration and environment settings
│   ├── controllers/         # Request handlers / route controllers
│   ├── middleware/           # Authentication, logging, and request middleware
│   ├── models/              # Data models / ORM entities
│   ├── routes/              # Route definitions
│   ├── services/            # Business logic layer
│   ├── utils/               # Shared helper functions
│   └── views/               # UI templates and frontend assets
├── storage/                 # User-uploaded and system-generated files
│   ├── devices/             # Per-device files (history, evidence)
│   ├── clients/             # Per-client files (documents, notification logs)
│   ├── tickets/             # Per-ticket files (chat history, attachments)
│   ├── organizations/       # Organization-level files (logos, maps, SAT docs)
│   └── backups/             # System database and config backups
├── docs/                    # Project documentation
├── public/                  # Public web assets (CSS, JS, images)
├── tests/                   # Automated tests
├── LICENSE
└── README.md
```

## Database

FireISP 5.0 uses MySQL 8.0+ (or MariaDB 10.6+). The schema is located in the `database/` directory.

### Quick Start

Apply the full schema in one step:

```bash
mysql -u <user> -p <database_name> < database/schema.sql
```

Or apply each migration in order:

```bash
for f in database/migrations/*.sql; do mysql -u <user> -p <database_name> < "$f"; done
```

### Database Tables

| # | Table | Description |
|---|-------|-------------|
| 1 | `users` | System users and employees (admins, technicians, billing, support) |
| 2 | `clients` | ISP customer records |
| 3 | `contacts` | Contact persons associated with clients |
| 4 | `sites` | Transport network NMS locations (POPs, data centers, towers, aggregation nodes) |
| 5 | `plans` | Internet service packages |
| 6 | `contracts` | Service contracts linking clients to plans |
| 7 | `nas` | Network Access Servers for RADIUS authentication |
| 8 | `radius` | RADIUS subscriber authentication accounts |
| 9 | `devices` | Network equipment inventory — client CPE (outdoor/indoor) and POP infrastructure (PTP, PTMP, OLT, Router, Switch, ONU) |
| 10 | `tickets` | Customer support tickets |
| 11 | `invoices` | Billing records issued to clients |
| 12 | `payments` | Payment records received from clients |
| 13 | `quotes` | Service estimates and proposals |
| 14 | `jobs` | Field work orders (installations, maintenance, repairs) |
| 15 | `expenses` | Operational expenses, optionally linked to jobs |
| 16 | `organizations` | ISP company / tenant configuration |
| 17 | `files` | File metadata for entity-scoped storage (devices, clients, tickets, organizations, backups) |
| 18 | `ip_pools` | IP address pools for subscriber assignment (IPAM) — supports both IPv4 and IPv6 pools |
| 19 | `ip_assignments` | Individual IP / prefix assignments to clients and devices (IPv4 single-address or IPv6 prefix delegation) |
| 20 | `audit_logs` | System-wide audit trail (who changed what and when) |
| 21 | `notifications` | User notifications and alerts (billing, network, tickets) |

### Storage Folders

The `storage/` directory holds user-uploaded and system-generated files organized by entity type. The `files` database table stores metadata and paths for every stored file.

| Folder | Entity Type | File Categories |
|--------|-------------|-----------------|
| `storage/devices/` | Devices | device_history, evidence |
| `storage/clients/` | Clients | client_file, notification_log |
| `storage/tickets/` | Tickets | chat_history, document |
| `storage/organizations/` | Organizations | isp_info, sat, online_payment, map, logo |
| `storage/backups/` | System | backup |

## Getting Started

### IPv4 / IPv6 / Dual-Stack Support

The schema is ready for IPv4-only, IPv6-only, and dual-stack deployments:

| Table | IPv4 | IPv6 | Dual-Stack Notes |
|-------|------|------|------------------|
| `ip_pools` | `ip_version = '4'` | `ip_version = '6'` | Create separate pools per address family; link both to the same site |
| `ip_assignments` | Single address (`prefix_len` = NULL) | Address or prefix (`prefix_len` = 48, 56, 64, …) | One row per address/prefix; a dual-stack subscriber gets one v4 + one v6 assignment |
| `radius` | `ip_address` | `ipv6_address` + `ipv6_delegated_prefix` / `ipv6_prefix_len` | All IPv6 fields coexist with the IPv4 field for seamless dual-stack RADIUS sessions |
| `nas` | `ip_address` | `ipv6_address` | Both addresses stored per NAS for dual-stack management |
| `devices` | `ip_address` | `ipv6_address` | Both addresses stored per device for dual-stack management |

Documentation and setup instructions will be added as the project develops.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
