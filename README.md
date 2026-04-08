# FireISP 5.0

An open source ISP (Internet Service Provider) management software designed to help ISPs manage their customers, plans, billing, and network infrastructure.

## Features

- Customer management
- Service plan management
- Billing, invoicing, and credit notes
- Network device monitoring with SNMP metrics collection
- Connection logging for regulatory compliance and per-contract data usage (RADIUS accounting)
- Inventory and warehouse management — track spare equipment across multiple storage locations
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
| 22 | `invoice_items` | Individual line items that make up an invoice's subtotal |
| 23 | `quote_items` | Individual line items that make up a quote's subtotal |
| 24 | `ticket_comments` | Conversation tracking and internal notes on support tickets |
| 25 | `snmp_metrics` | Raw SNMP poll data (5-min intervals, 90-day retention) — wide table, one row per device/interface per poll, partitioned by month |
| 26 | `snmp_metrics_1hr` | Hourly SNMP metric aggregates (avg/min/max per metric column, 1-year retention) |
| 27 | `snmp_metrics_1day` | Daily SNMP metric aggregates (avg/min/max per metric column, 3+ year retention) |
| 28 | `snmp_rollup_state` | High-watermark table tracking the last successfully rolled-up timestamp per tier |
| 29 | `snmp_profiles` | SNMP OID polling profiles — named templates that map device brands/models to their OIDs |
| 30 | `snmp_profile_oids` | Individual OID-to-column mappings belonging to an SNMP profile |
| 31 | `connection_logs` | Subscriber session events (start/stop/interim-update) for regulatory compliance and per-contract data usage — partitioned by month, 2-year retention |
| 32 | `warehouses` | Physical storage locations for spare equipment and materials (multiple warehouses supported) |
| 33 | `inventory_items` | Catalog of spare equipment and materials (antennas, cables, routers, ONUs, etc.) |
| 34 | `inventory_stock` | Current stock levels per item per warehouse location (aisle / column / shelf) |
| 35 | `inventory_transactions` | Immutable log of every stock movement — receiving, job assignments, client sales, transfers, returns, and adjustments |
| 36 | `credit_notes` | Credit notes issued to clients — for returns, courtesy, service outages, billing errors, duplicate payments, downgrades, cancellations, etc. |
| 37 | `credit_note_items` | Individual line items that make up a credit note's subtotal |
| 38 | `payment_allocations` | Junction table for split payments — records what portion of a payment was applied to each invoice (supports one-payment-many-invoices) |

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

### Connection Types

Each contract specifies a `connection_type` that determines how the client connects and whether RADIUS is required:

| Connection Type | Description | RADIUS Required | IP Management |
|-----------------|-------------|-----------------|---------------|
| `pppoe` (default) | PPPoE session — IPv4 only via RADIUS | Yes — create a `radius` record linked to the contract | `radius.ip_address` (static) or `radius.ipv4_pool_id` pool-assigned (dynamic) |
| `pppoe_dual` | PPPoE session — dual-stack IPv4 + IPv6 via RADIUS | Yes — create a `radius` record with IPv4 and IPv6 fields | `radius.ip_address` + `radius.ipv6_address` / `radius.ipv6_delegated_prefix` (static) or pool-assigned via `radius.ipv4_pool_id` + `radius.ipv6_pool_id` (dynamic) |
| `static` | Static IPv4 — IP assigned directly, no PPPoE | No | `ip_assignments` row linked to the contract via `contract_id` |
| `dual` | Dual-stack static IPv4 + IPv6 — no PPPoE | No | One IPv4 + one IPv6 `ip_assignments` row, both linked to the contract |

### IPv4 / IPv6 / Dual-Stack Support

The schema is ready for IPv4-only, IPv6-only, and dual-stack deployments:

| Table | IPv4 | IPv6 | Dual-Stack Notes |
|-------|------|------|------------------|
| `ip_pools` | `ip_version = '4'` | `ip_version = '6'` | Create separate pools per address family; link both to the same site |
| `ip_assignments` | Single address (`prefix_len` = NULL) | Address or prefix (`prefix_len` = 48, 56, 64, …) | One row per address/prefix; a dual-stack subscriber gets one v4 + one v6 assignment |
| `radius` | `ip_address` (static) or `ipv4_pool_id` (dynamic) | `ipv6_address` + `ipv6_delegated_prefix` / `ipv6_prefix_len` (static) or `ipv6_pool_id` (dynamic) | All IPv6 fields coexist with IPv4 for seamless dual-stack PPPoE sessions; `nas_id` links the subscriber to its NAS |
| `nas` | `ip_address` | `ipv6_address` | Both addresses stored per NAS for dual-stack management |
| `devices` | `ip_address` | `ipv6_address` | Both addresses stored per device for dual-stack management |

### SNMP Monitoring

The `devices` table includes SNMP configuration columns (`snmp_enabled`, `snmp_community`, `snmp_version`, `snmp_port`) so that both **client CPE** and **POP infrastructure** devices can be polled. Collected metrics are stored in a three-tier structure for efficient querying and long-term retention:

| Data Tier | Resolution | Retention | Description |
|-----------|------------|-----------|-------------|
| `snmp_metrics` (raw) | 5-min polls | 90 days | Wide table — one row per device/interface per poll (8× fewer rows than narrow EAV); monthly partitions enable instant `DROP PARTITION` retention |
| `snmp_metrics_1hr` | Hourly averages | 1 year | Wide table — per-metric `avg_*` / `min_*` / `max_*` columns; idempotent rollup via `INSERT … ON DUPLICATE KEY UPDATE` |
| `snmp_metrics_1day` | Daily averages | 3+ years | Wide table — aggregated from `snmp_metrics_1hr`; kept indefinitely |

#### Supported SNMP Metrics

Each raw poll row stores up to eight metrics as individual columns:

| Column | Type | Description |
|--------|------|-------------|
| `if_in_octets` | `BIGINT` | ifInOctets — bytes received |
| `if_out_octets` | `BIGINT` | ifOutOctets — bytes transmitted |
| `if_in_errors` | `BIGINT` | ifInErrors — inbound error count |
| `if_out_errors` | `BIGINT` | ifOutErrors — outbound error count |
| `cpu_usage` | `SMALLINT` | CPU utilization percentage |
| `memory_usage` | `SMALLINT` | Memory utilization percentage |
| `signal_strength` | `INTEGER` | Wireless signal strength in dBm |
| `latency_ms` | `DECIMAL(10,2)` | ICMP ping latency in milliseconds |

The optional `interface_id` column stores the SNMP `ifIndex` or `ifDescr` for interface-level metrics (e.g., multiple interfaces on a router or switch).

#### Scale Targets

| Metric | Value |
|--------|-------|
| Devices | 6,000 |
| Poll interval | 5 minutes |
| Rows per day (raw) | ~1.73 million |
| Raw retention | 90 days (~155 million rows) |
| Raw table design | Wide — no FK, no per-row OID, monthly partitions |

#### Automated Rollup & Retention (MySQL Event Scheduler)

Data aggregation and retention are handled by MySQL stored procedures and scheduled events — the MySQL equivalent of TimescaleDB continuous aggregates and retention policies. The MySQL Event Scheduler must be enabled:

```sql
SET GLOBAL event_scheduler = ON;
```

Or in `my.cnf` / `my.ini`:

```ini
[mysqld]
event_scheduler = ON
```

| Event | Schedule | Action |
|-------|----------|--------|
| `evt_snmp_rollup_1hr` | Every hour at :05 | Calls `snmp_rollup_to_1hr()` — aggregates raw → hourly using high-watermark |
| `evt_snmp_rollup_1day` | Daily at 00:30 | Calls `snmp_rollup_to_1day()` — aggregates hourly → daily using high-watermark |
| `evt_snmp_retention` | Daily at 02:00 | Calls `snmp_apply_retention()` — purges hourly data older than 1 year |
| `evt_snmp_partition_maintenance` | Daily at 03:00 | Calls `snmp_maintain_partitions()` — adds future month partitions and drops expired ones (replaces batch DELETE for raw data retention) |

All rollup procedures use a **high-watermark** (`snmp_rollup_state` table) to track the last successfully processed timestamp, so missed runs catch up automatically rather than only looking back a fixed window. Rollup procedures use `INSERT … ON DUPLICATE KEY UPDATE` for idempotent re-runs. Raw data retention is instant (partition `DROP`) while hourly retention uses batch deletes (10 000 rows per iteration) since that table is much smaller.

### Connection Logs (Compliance & Usage)

The `connection_logs` table records every RADIUS accounting event (`start`, `stop`, `interim-update`) per contract, providing a complete audit trail of subscriber sessions for regulatory compliance. Each row is **self-contained** — it captures the subscriber identity, assigned IP address(es), NAS, and session counters at the time of the event, so the record remains valid even if the contract or client is later deleted.

| Column | Description |
|--------|-------------|
| `contract_id` / `client_id` | Contract and client at time of session (no FK — compliance) |
| `username` | RADIUS username at time of session |
| `session_id` | RADIUS Acct-Session-Id |
| `ip_address` / `ipv6_address` / `ipv6_delegated_prefix` | IP address(es) assigned during the session |
| `nas_id` / `nas_ip_address` | NAS that authenticated the session |
| `event_type` | `start`, `stop`, or `interim-update` |
| `bytes_in` / `bytes_out` / `packets_in` / `packets_out` | Session traffic counters (at stop/interim) |
| `session_duration` | Duration in seconds (at stop) |
| `terminate_cause` | RADIUS Acct-Terminate-Cause (at stop) |

**Retention:** 2 years via monthly partition `DROP`, managed by `connection_logs_maintain_partitions()`.

| Event | Schedule | Action |
|-------|----------|--------|
| `evt_connection_logs_partition_maintenance` | Daily at 03:30 | Calls `connection_logs_maintain_partitions()` — adds future month partitions and drops expired ones (2-year retention) |

**Typical queries:**

```sql
-- Who had IP 10.0.1.42 on 2026-03-15?
SELECT * FROM connection_logs
WHERE ip_address = '10.0.1.42'
  AND event_at >= '2026-03-15' AND event_at < '2026-03-16';

-- All sessions for contract #123 in March 2026
SELECT * FROM connection_logs
WHERE contract_id = 123
  AND event_at >= '2026-03-01' AND event_at < '2026-04-01';

-- Total data usage per contract for billing period
SELECT contract_id,
       SUM(bytes_in)  AS total_download,
       SUM(bytes_out) AS total_upload
FROM connection_logs
WHERE event_type IN ('stop', 'interim-update')
  AND event_at >= '2026-03-01' AND event_at < '2026-04-01'
GROUP BY contract_id;
```

### SNMP OID Profile System

The SNMP OID profile system lets you customize which OIDs are polled for each device brand and model without changing any application code — just insert new rows into the profile tables.

#### How Profiles Work

Each `snmp_profiles` row is a named polling template that the poller selects for a device. Once a profile is selected, the poller walks every OID listed in `snmp_profile_oids` for that profile and stores each result in the corresponding `snmp_metrics` wide-table column (`metric_column`).

#### Profile Resolution Order

For every device where `snmp_enabled = TRUE`, the poller resolves its profile as follows:

1. **Explicit override** — if `devices.snmp_profile_id IS NOT NULL`, use that profile directly.
2. **Auto-match** — otherwise query `snmp_profiles` for the best match:
   ```sql
   SELECT * FROM snmp_profiles
   WHERE (manufacturer  = device.manufacturer  OR manufacturer  IS NULL)
     AND (device.model LIKE model_pattern       OR model_pattern IS NULL)
     AND (device_type   = device.type           OR device_type   IS NULL)
     AND status = 'active'
   ORDER BY manufacturer DESC, model_pattern DESC, device_type DESC
   LIMIT 1;
   ```
   More-specific matches (manufacturer + model_pattern + device_type) rank higher than wildcard rows.
3. **Default fallback** — if no profile matches, select the profile with `is_default = TRUE` and `status = 'active'`.
4. **Walk OIDs** — fetch all `snmp_profile_oids` rows for the resolved profile and poll each OID, storing results into `snmp_metrics` using the `metric_column` mapping.

#### Pre-Seeded Profiles

| Profile | `manufacturer` | Key Vendor OIDs |
|---------|---------------|-----------------|
| **Generic IF-MIB** *(default)* | `NULL` (any) | Standard IF-MIB (RFC 2863) interface counters + HOST-RESOURCES-MIB CPU/memory |
| **Ubiquiti airOS** | `Ubiquiti` | Enterprise `1.3.6.1.4.1.41112.*` OIDs for signal strength, CPU, memory |
| **MikroTik RouterOS** | `MikroTik` | Enterprise `1.3.6.1.4.1.14988.*` OID for wireless signal + HOST-RESOURCES-MIB |
| **Cambium Networks** | `Cambium` | Enterprise `1.3.6.1.4.1.161.*` OIDs for RSSI and CPU |

#### Adding a New Vendor Profile

To add a new brand or model without touching any code:

```sql
-- 1. Create the profile
INSERT INTO snmp_profiles (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, description)
VALUES ('Huawei OLT', 'Huawei', NULL, 'olt', 'v2c', 300, 'Huawei OLT devices — MA5800 series');

-- 2. Map the OIDs
INSERT INTO snmp_profile_oids (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
VALUES
    (LAST_INSERT_ID(), '1.3.6.1.2.1.2.2.1.10', 'if_in_octets',  'Inbound Octets',  'counter', TRUE,  10),
    (LAST_INSERT_ID(), '1.3.6.1.2.1.2.2.1.16', 'if_out_octets', 'Outbound Octets', 'counter', TRUE,  20),
    (LAST_INSERT_ID(), '1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4', 'cpu_usage', 'Huawei CPU (%)', 'gauge', FALSE, 30);
```

The next poll cycle will automatically use the new profile for all Huawei OLT devices.

### Inventory / Warehouse

The inventory system tracks spare equipment and materials across multiple physical warehouses. Each warehouse can define granular storage locations using **aisle**, **column**, and **shelf** identifiers. Items move through the system via an immutable transaction log, supporting the full lifecycle from purchase to deployment or sale.

#### Tables Overview

| Table | Purpose |
|-------|---------|
| `warehouses` | Physical storage locations (multiple warehouses supported) |
| `inventory_items` | Product catalog — each row is a type of spare part or material |
| `inventory_stock` | Current quantity on hand per item per warehouse location (aisle/column/shelf) |
| `inventory_transactions` | Immutable movement log — every receive, assignment, sale, transfer, return, or adjustment |

#### Transaction Types

| Type | Direction | Description |
|------|-----------|-------------|
| `receive` | Inbound (+) | New stock received from a supplier |
| `assign_to_job` | Outbound (−) | Item used on a field work order (`jobs`) |
| `sell_to_client` | Outbound (−) | Item sold directly to a client (optionally linked to an invoice) |
| `transfer_out` | Outbound (−) | Item sent to another warehouse location |
| `transfer_in` | Inbound (+) | Item received from another warehouse location |
| `return` | Inbound (+) | Item returned from a job or client |
| `adjustment` | +/− | Manual stock correction (shrinkage, recount, etc.) |

#### Item Categories

`antenna`, `cable`, `router`, `switch`, `onu`, `olt`, `cpe`, `connector`, `power_supply`, `enclosure`, `tool`, `other`

#### Typical Queries

```sql
-- Current stock for all items across all warehouses
SELECT ii.name, w.name AS warehouse, s.aisle, s.col, s.shelf, s.quantity
FROM inventory_stock s
JOIN inventory_items ii ON ii.id = s.item_id
JOIN warehouses w ON w.id = s.warehouse_id
ORDER BY ii.name, w.name;

-- Items below reorder level
SELECT ii.name, ii.reorder_level, SUM(s.quantity) AS total_on_hand
FROM inventory_items ii
JOIN inventory_stock s ON s.item_id = ii.id
WHERE ii.reorder_level IS NOT NULL AND ii.status = 'active'
GROUP BY ii.id
HAVING total_on_hand < ii.reorder_level;

-- All transactions for a specific job
SELECT it.*, ii.name AS item_name
FROM inventory_transactions it
JOIN inventory_stock s ON s.id = it.stock_id
JOIN inventory_items ii ON ii.id = s.item_id
WHERE it.job_id = 42;

-- Revenue from inventory sales in March 2026
SELECT ii.name, SUM(ABS(it.quantity)) AS units_sold,
       SUM(ABS(it.quantity) * it.unit_price) AS revenue
FROM inventory_transactions it
JOIN inventory_stock s ON s.id = it.stock_id
JOIN inventory_items ii ON ii.id = s.item_id
WHERE it.transaction_type = 'sell_to_client'
  AND it.created_at >= '2026-03-01' AND it.created_at < '2026-04-01'
GROUP BY ii.id;
```

Documentation and setup instructions will be added as the project develops.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
