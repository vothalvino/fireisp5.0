# FireISP 5.0

An open source ISP (Internet Service Provider) management software designed to help ISPs manage their customers, plans, billing, and network infrastructure.

## Features

- Customer management
- Service plan management
- Billing and invoicing
- Network device monitoring
- User and role management

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
| 4 | `sites` | Physical installation locations |
| 5 | `plans` | Internet service packages |
| 6 | `contracts` | Service contracts linking clients to plans |
| 7 | `nas` | Network Access Servers for RADIUS authentication |
| 8 | `radius` | RADIUS subscriber authentication accounts |
| 9 | `devices` | Network equipment inventory (CPEs, antennas, routers, switches) |
| 10 | `tickets` | Customer support tickets |
| 11 | `invoices` | Billing records issued to clients |
| 12 | `payments` | Payment records received from clients |
| 13 | `quotes` | Service estimates and proposals |
| 14 | `jobs` | Field work orders (installations, maintenance, repairs) |
| 15 | `expenses` | Operational expenses, optionally linked to jobs |

## Getting Started

Documentation and setup instructions will be added as the project develops.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
