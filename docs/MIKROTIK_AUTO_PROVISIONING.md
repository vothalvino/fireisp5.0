# MikroTik Auto-Provisioning — Development Guideline

> **Purpose:** This document is the master specification for building FireISP 5.0's MikroTik auto-provisioning subsystem. It describes every feature, file location, database schema change, API endpoint, and test expectation that development agents should implement. Work should be broken into the phases listed below, each of which is independently shippable.

---

## Table of Contents

1. [Vision](#vision)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1 — MikroTik Connection Layer (SSH + REST API)](#phase-1--mikrotik-connection-layer-ssh--rest-api)
4. [Phase 2 — Router Provisioning Templates](#phase-2--router-provisioning-templates)
5. [Phase 3 — PPPoE Server & Subscriber Provisioning](#phase-3--pppoe-server--subscriber-provisioning)
6. [Phase 4 — Queue / Bandwidth Management](#phase-4--queue--bandwidth-management)
7. [Phase 5 — Firewall, NAT & Mangle Rules](#phase-5--firewall-nat--mangle-rules)
8. [Phase 6 — RADIUS Integration on the MikroTik Side](#phase-6--radius-integration-on-the-mikrotik-side)
9. [Phase 7 — IP Pool & DHCP Sync](#phase-7--ip-pool--dhcp-sync)
10. [Phase 8 — Real-Time Monitoring & Health Checks](#phase-8--real-time-monitoring--health-checks)
11. [Phase 9 — Config Backup & Restore](#phase-9--config-backup--restore)
12. [Phase 10 — Firmware & Scheduler Management](#phase-10--firmware--scheduler-management)
13. [Database Migrations](#database-migrations)
14. [Environment Variables](#environment-variables)
15. [NPM Dependencies](#npm-dependencies)
16. [API Endpoints](#api-endpoints)
17. [Dashboard UI Pages](#dashboard-ui-pages)
18. [Testing Requirements](#testing-requirements)
19. [Security Considerations](#security-considerations)
20. [Conventions & Rules](#conventions--rules)

---

## Vision

FireISP 5.0 should be able to **fully configure a MikroTik router from scratch** when an ISP operator adds a new device in the dashboard. This means:

- **SSH transport** for CLI commands (`/ip address add`, `/queue simple add`, etc.).
- **MikroTik REST API** (RouterOS v7.1+) for structured read/write operations.
- **RADIUS** for PPPoE authentication, accounting, and bandwidth control (already partially built).
- **Automatic rollback** — if a provisioning step fails, previous commands in that batch are reverted.
- **Template-driven** — operators define reusable provisioning templates per router role (core, access, CPE).
- **Audit trail** — every command sent to a router is logged with timestamp, user, and result.

The subsystem should be **optional** — controlled by a feature flag `FEATURE_MIKROTIK=true` so it can be disabled without affecting the rest of the application.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FireISP 5.0 Server                    │
│                                                         │
│  src/services/mikrotik/                                 │
│  ├── MikrotikSSHClient.js    ← SSH transport (ssh2)     │
│  ├── MikrotikAPIClient.js    ← REST API transport       │
│  ├── MikrotikConnectionPool.js ← Manages connections    │
│  ├── provisioningEngine.js   ← Template renderer        │
│  ├── routerSetupService.js   ← Full router provisioning │
│  ├── pppoeService.js         ← PPPoE server/secrets     │
│  ├── queueService.js         ← Simple/Tree queues       │
│  ├── firewallService.js      ← Filter/NAT/Mangle        │
│  ├── dhcpService.js          ← DHCP server/pools        │
│  ├── ipPoolService.js        ← IP pool sync             │
│  ├── monitorService.js       ← Health, resource, iface  │
│  ├── backupService.js        ← /system backup & export  │
│  └── firmwareService.js      ← Package check & upgrade  │
│                                                         │
│  src/controllers/mikrotikController.js                  │
│  src/routes/mikrotik.js                                 │
│  src/models/MikrotikTemplate.js                         │
│  src/models/MikrotikCommandLog.js                       │
│  src/middleware/schemas/mikrotikSchemas.js               │
└─────────────────────────────────────────────────────────┘
          │ SSH (port 22)          │ REST API (port 443/80)
          ▼                        ▼
   ┌──────────────────────────────────────┐
   │         MikroTik RouterOS            │
   │  - PPPoE Server (RADIUS-backed)      │
   │  - Queues (Simple / Tree / PCQ)      │
   │  - Firewall (filter, nat, mangle)    │
   │  - DHCP Server                       │
   │  - IP Pools                          │
   │  - RADIUS Client → FreeRADIUS → DB   │
   └──────────────────────────────────────┘
```

### Transport Priority

1. **MikroTik REST API** (preferred for RouterOS ≥ 7.1) — structured JSON, faster, less fragile.
2. **SSH** (fallback for RouterOS v6.x or when API is disabled) — raw CLI commands.
3. Each service method should accept a `transport` option: `'api'`, `'ssh'`, or `'auto'` (default). When `'auto'`, detect RouterOS version and pick the best transport.

---

## Phase 1 — MikroTik Connection Layer (SSH + REST API)

### Goal
Build the low-level clients that all other phases depend on.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/MikrotikSSHClient.js` | SSH connection using the `ssh2` npm package. Provides `exec(command)`, `execBatch(commands[])`, `close()`. |
| `src/services/mikrotik/MikrotikAPIClient.js` | HTTPS client for MikroTik REST API (RouterOS v7.1+). Methods: `get(path)`, `post(path, body)`, `put(path, id, body)`, `delete(path, id)`, `command(path, body)`. Uses `fetch` (Node 18+). |
| `src/services/mikrotik/MikrotikConnectionPool.js` | Connection pool / cache keyed by device ID. Reuses SSH sessions for 60s. Limits max concurrent sessions per device to 1. |
| `src/services/mikrotik/index.js` | Re-exports all services for clean imports. |

### MikrotikSSHClient API

```javascript
class MikrotikSSHClient {
  constructor({ host, port = 22, username = 'admin', password, privateKey })
  async connect()                          // Returns this
  async exec(command)                      // Returns { output, error, duration }
  async execBatch(commands, { rollback })  // Runs array; if one fails, runs rollback commands
  async getRouterOSVersion()               // Parses /system resource print
  async close()
}
```

### MikrotikAPIClient API

```javascript
class MikrotikAPIClient {
  constructor({ host, port = 443, username = 'admin', password, useTLS = true })
  async get(path)                    // GET /rest/{path}
  async post(path, body)             // PUT /rest/{path} (MikroTik uses PUT for create)
  async patch(path, id, body)        // PATCH /rest/{path}/{id}
  async remove(path, id)             // DELETE /rest/{path}/{id}
  async command(path, body)          // POST /rest/{path} (for commands like /system/reboot)
  async getRouterOSVersion()         // GET /rest/system/resource
}
```

### Device Model Changes

Extend `src/models/Device.js` fillable fields to add:
```
'mikrotik_username', 'mikrotik_password', 'mikrotik_ssh_port',
'mikrotik_api_port', 'mikrotik_api_tls', 'mikrotik_transport',
'routeros_version', 'mikrotik_template_id'
```

> **Important:** `mikrotik_password` must be encrypted at rest using the existing `ENCRYPTION_KEY` mechanism (AES-256-GCM) from the codebase.

### NAS Model Changes

Add `coa_port` to `src/models/Nas.js` fillable (if not already present — verify in the database schema).

---

## Phase 2 — Router Provisioning Templates

### Goal
Allow operators to define reusable router configuration templates that render with Mustache-style `{{ variable }}` placeholders.

### Database: `mikrotik_templates` Table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT PK AUTO_INCREMENT | |
| `organization_id` | INT FK | |
| `name` | VARCHAR(100) | e.g., "Access Router — Standard" |
| `description` | TEXT | |
| `router_role` | ENUM('core','distribution','access','cpe') | |
| `commands` | JSON | Ordered array of command objects (see below) |
| `variables` | JSON | Schema of expected variables with defaults |
| `rollback_commands` | JSON | Commands to undo this template |
| `is_default` | BOOLEAN DEFAULT FALSE | |
| `status` | ENUM('active','draft','archived') | |
| `created_at` / `updated_at` | TIMESTAMPS | |

### Command Object Shape (inside `commands` JSON)

```json
{
  "step": 1,
  "description": "Set router identity",
  "transport": "auto",
  "ssh_command": "/system identity set name={{router_name}}",
  "api_path": "/system/identity",
  "api_method": "post",
  "api_body": { "name": "{{router_name}}" },
  "rollback_ssh": "/system identity set name=MikroTik",
  "continue_on_error": false
}
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/models/MikrotikTemplate.js` | Model (extends BaseModel, table `mikrotik_templates`, org-scoped) |
| `src/services/mikrotik/provisioningEngine.js` | Renders templates: replaces `{{ var }}" with values, executes commands in order, handles rollback on failure. |

### Provisioning Engine Logic

```
1. Load template by ID
2. Merge variable defaults with provided overrides
3. For each command:
   a. Render {{variables}} in ssh_command / api_body
   b. Determine transport (api vs ssh vs auto)
   c. Execute command
   d. Log result to mikrotik_command_logs
   e. If error AND continue_on_error === false → run rollback commands → abort
4. Return summary: { success, steps_completed, steps_total, errors }
```

---

## Phase 3 — PPPoE Server & Subscriber Provisioning

### Goal
When a new contract is created with a PPPoE plan, FireISP auto-configures the MikroTik router:

1. Ensure a PPPoE server exists on the correct interface.
2. Add a PPPoE profile matching the plan's speed limits.
3. Add a PPPoE secret for the subscriber (or rely on RADIUS — see Phase 6).

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/pppoeService.js` | Functions: `ensurePPPoEServer(device, iface, poolName)`, `syncProfile(device, plan)`, `addSecret(device, contract)`, `removeSecret(device, username)`, `listActiveSessions(device)`, `disconnectSession(device, username)` |

### SSH Commands Used

```
/ppp profile add name={{plan_name}} rate-limit={{upload}}M/{{download}}M local-address={{gateway}} remote-address={{pool_name}}
/ppp secret add name={{username}} password={{password}} profile={{plan_name}} service=pppoe
/interface pppoe-server server add service-name={{service_name}} interface={{interface}} default-profile={{default_profile}} authentication=radius,pap,chap
/ppp active print where name={{username}}
/ppp active remove [find name={{username}}]
```

### API Equivalents (RouterOS v7+)

```
PUT  /rest/ppp/profile  { "name": "...", "rate-limit": "..." }
PUT  /rest/ppp/secret   { "name": "...", "password": "...", "profile": "..." }
GET  /rest/ppp/active
POST /rest/ppp/active/remove  { ".id": "..." }
```

### Integration Points

- **On contract creation** → call `pppoeService.addSecret()` (if not using pure RADIUS).
- **On plan change** → call `pppoeService.syncProfile()` then disconnect active session so new profile applies.
- **On contract suspension** → call `pppoeService.disconnectSession()`.
- **On contract cancellation** → call `pppoeService.removeSecret()`.

---

## Phase 4 — Queue / Bandwidth Management

### Goal
Sync plan bandwidth limits to MikroTik Simple Queues or Queue Trees.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/queueService.js` | Functions: `addSimpleQueue(device, contract)`, `updateSimpleQueue(device, contract)`, `removeSimpleQueue(device, contract)`, `addQueueTree(device, plan)`, `addPCQType(device, plan)`, `listQueues(device)` |

### SSH Commands

```
/queue simple add name=client-{{contract_id}} target={{client_ip}}/32 max-limit={{upload}}M/{{download}}M burst-limit={{burst_upload}}M/{{burst_download}}M burst-threshold={{burst_thresh_up}}M/{{burst_thresh_down}}M burst-time={{burst_time}}s/{{burst_time}}s comment="{{client_name}} - {{plan_name}}"
/queue simple set [find name=client-{{contract_id}}] max-limit={{upload}}M/{{download}}M
/queue simple remove [find name=client-{{contract_id}}]
```

### When Queues are Used vs. RADIUS Rate-Limit

| Strategy | When to Use | How |
|----------|-------------|-----|
| **RADIUS Mikrotik-Rate-Limit** | Preferred for PPPoE setups | Already handled in `radius` table `download_speed`/`upload_speed` |
| **Simple Queues via SSH/API** | Static IP clients, DHCP clients, or when finer burst control is needed | This phase |
| **Queue Tree + PCQ** | Fair queuing across many users on shared bandwidth | This phase |

The operator should be able to pick the strategy per-plan in the plan settings.

---

## Phase 5 — Firewall, NAT & Mangle Rules

### Goal
Auto-configure essential firewall and NAT rules on a newly provisioned router.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/firewallService.js` | Functions: `applyDefaultFirewall(device)`, `addSrcNat(device, outInterface, srcRange)`, `addDstNat(device, dstPort, toAddress, toPort)`, `addAddressList(device, listName, addresses[])`, `removeAddressList(device, listName)`, `addMangleRule(device, rule)` |

### Default Firewall Template
The template applied on first provisioning should include at minimum:

```
# Allow established/related
/ip firewall filter add chain=input action=accept connection-state=established,related
/ip firewall filter add chain=forward action=accept connection-state=established,related

# Drop invalid
/ip firewall filter add chain=input action=drop connection-state=invalid
/ip firewall filter add chain=forward action=drop connection-state=invalid

# Allow ICMP
/ip firewall filter add chain=input action=accept protocol=icmp

# Protect router services
/ip firewall filter add chain=input action=accept src-address-list=management protocol=tcp dst-port=22,8728,8729,80,443
/ip firewall filter add chain=input action=drop in-interface-list=WAN

# Masquerade
/ip firewall nat add chain=srcnat out-interface={{wan_interface}} action=masquerade
```

---

## Phase 6 — RADIUS Integration on the MikroTik Side

### Goal
Auto-configure the MikroTik RADIUS client to point to the FireISP FreeRADIUS server.

> **Context:** FireISP already has `radiusService.js`, `suspensionService.js`, and `docs/radius-setup.md`. This phase configures the **MikroTik router** to use that RADIUS server.

### Files to Create / Modify

| File | Purpose |
|------|---------|
| `src/services/mikrotik/radiusSetupService.js` | Functions: `configureRadiusClient(device, radiusServer)`, `enableRadiusIncoming(device)`, `setRadiusForPPPoE(device)`, `verifyRadiusConnectivity(device)` |

### SSH Commands

```
# Add RADIUS server
/radius add address={{radius_server_ip}} secret={{radius_secret}} service=ppp,login timeout=3000ms

# Enable RADIUS incoming (CoA/Disconnect)
/radius incoming set accept=yes port=3799

# Set PPPoE server to use RADIUS
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

# Optional: use RADIUS for login authentication
/user aaa set use-radius=yes
```

### Integration with Existing Code

- Read `RADIUS_HOST` and `RADIUS_SECRET` from env (already defined in `.env.example`).
- When a NAS device is created in FireISP, call `radiusSetupService.configureRadiusClient()` to auto-configure the MikroTik.
- Verify connectivity by calling `radtest` equivalent via the MikroTik's built-in RADIUS test or by checking `/radius monitor`.

---

## Phase 7 — IP Pool & DHCP Sync

### Goal
Sync FireISP's `ip_pools` table to MikroTik's IP pool and DHCP server configuration.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/ipPoolService.js` | Functions: `syncPool(device, pool)`, `removePool(device, poolName)`, `listPools(device)` |
| `src/services/mikrotik/dhcpService.js` | Functions: `addDHCPServer(device, iface, pool, gateway, dns)`, `addDHCPLease(device, mac, ip, comment)`, `removeDHCPLease(device, mac)`, `listLeases(device)` |

### SSH Commands

```
/ip pool add name={{pool_name}} ranges={{start_ip}}-{{end_ip}}
/ip pool set [find name={{pool_name}}] ranges={{start_ip}}-{{end_ip}}
/ip dhcp-server add name=dhcp-{{iface}} interface={{iface}} address-pool={{pool_name}} lease-time=1d
/ip dhcp-server network add address={{network}}/{{cidr}} gateway={{gateway}} dns-server={{dns1}},{{dns2}}
/ip dhcp-server lease add mac-address={{mac}} address={{ip}} comment="{{client_name}}"
```

---

## Phase 8 — Real-Time Monitoring & Health Checks

### Goal
Extend the existing SNMP poller with MikroTik-specific SSH/API monitoring for richer data.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/monitorService.js` | Functions: `getSystemResource(device)`, `getInterfaceTraffic(device)`, `getActivePPPoESessions(device)`, `getRouterHealth(device)`, `getLogEntries(device, count)` |

### Data Points to Collect

| Metric | SSH Command | API Path |
|--------|-------------|----------|
| CPU / RAM / Uptime | `/system resource print` | `/rest/system/resource` |
| Interface traffic | `/interface print stats` | `/rest/interface` |
| Active PPPoE sessions | `/ppp active print count-only` | `/rest/ppp/active` |
| DHCP leases | `/ip dhcp-server lease print count-only` | `/rest/ip/dhcp-server/lease` |
| Firewall connections | `/ip firewall connection tracking print count-only` | — |
| Log entries | `/log print last={{count}}` | `/rest/log` |
| Voltage/Temperature | `/system health print` | `/rest/system/health` |

### Integration

- The existing `scheduler.js` / `taskRunner.js` should add a new cron job: `mikrotik:health` that runs every 60 seconds (configurable via `MIKROTIK_HEALTH_INTERVAL`).
- Results are stored in a new `mikrotik_health_snapshots` table (similar pattern to `network_health_snapshots`).
- SSE event stream should emit `mikrotik.health` events.

---

## Phase 9 — Config Backup & Restore

### Goal
Periodically backup MikroTik configurations and store them in the database.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/backupService.js` | Functions: `createBackup(device)`, `createExport(device)`, `restoreBackup(device, backupId)`, `listBackups(deviceId)` |

### Two Backup Types

1. **Binary backup** (`/system backup save name=fireisp-{{date}}`) — full restore, includes passwords.
2. **Text export** (`/export file=fireisp-{{date}}`) — human-readable, diff-able.

### Storage

- Store backup content in the existing `device_config_backups` table (model already exists: `DeviceConfigBackup.js`).
- Add columns if needed: `backup_type ENUM('binary','export')`, `file_size INT`, `routeros_version VARCHAR(20)`. 
- The scheduler should run `mikrotik:backup` daily (configurable via `MIKROTIK_BACKUP_INTERVAL_HOURS`).

---

## Phase 10 — Firmware & Scheduler Management

### Goal
Check for RouterOS updates and manage MikroTik's built-in scheduler.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/mikrotik/firmwareService.js` | Functions: `checkForUpdates(device)`, `downloadUpdate(device)`, `applyUpdate(device)`, `getInstalledPackages(device)` |
| `src/services/mikrotik/schedulerService.js` | Functions: `addSchedulerTask(device, name, interval, script)`, `removeSchedulerTask(device, name)`, `listSchedulerTasks(device)` |

### SSH Commands

```
/system package update check-for-updates
/system package update download
/system package update install
/system scheduler add name={{name}} interval={{interval}} on-event={{script}} start-time=startup
```

---

## Database Migrations

Create the following migration files in `database/migrations/`:

### Migration: `XXX_create_mikrotik_templates.sql`

```sql
CREATE TABLE IF NOT EXISTS mikrotik_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  router_role ENUM('core','distribution','access','cpe') NOT NULL DEFAULT 'access',
  commands JSON NOT NULL,
  variables JSON,
  rollback_commands JSON,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('active','draft','archived') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_mt_org_role (organization_id, router_role),
  INDEX idx_mt_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Migration: `XXX_create_mikrotik_command_logs.sql`

```sql
CREATE TABLE IF NOT EXISTS mikrotik_command_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NOT NULL,
  template_id INT UNSIGNED,
  user_id INT UNSIGNED,
  transport ENUM('ssh','api') NOT NULL,
  command TEXT NOT NULL,
  response TEXT,
  status ENUM('success','error','timeout','rollback') NOT NULL,
  duration_ms INT UNSIGNED,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_mcl_device (device_id),
  INDEX idx_mcl_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Migration: `XXX_create_mikrotik_health_snapshots.sql`

```sql
CREATE TABLE IF NOT EXISTS mikrotik_health_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NOT NULL,
  cpu_load TINYINT UNSIGNED,
  memory_used_mb INT UNSIGNED,
  memory_total_mb INT UNSIGNED,
  disk_used_mb INT UNSIGNED,
  disk_total_mb INT UNSIGNED,
  uptime_seconds BIGINT UNSIGNED,
  temperature DECIMAL(5,1),
  voltage DECIMAL(5,2),
  active_pppoe_sessions INT UNSIGNED,
  active_dhcp_leases INT UNSIGNED,
  firewall_connections INT UNSIGNED,
  routeros_version VARCHAR(20),
  board_name VARCHAR(50),
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_mhs_device_time (device_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Migration: `XXX_alter_devices_add_mikrotik_fields.sql`

```sql
ALTER TABLE devices
  ADD COLUMN mikrotik_username VARCHAR(64) DEFAULT 'admin' AFTER snmp_profile_id,
  ADD COLUMN mikrotik_password VARBINARY(512) AFTER mikrotik_username,
  ADD COLUMN mikrotik_ssh_port SMALLINT UNSIGNED DEFAULT 22 AFTER mikrotik_password,
  ADD COLUMN mikrotik_api_port SMALLINT UNSIGNED DEFAULT 443 AFTER mikrotik_ssh_port,
  ADD COLUMN mikrotik_api_tls BOOLEAN DEFAULT TRUE AFTER mikrotik_api_port,
  ADD COLUMN mikrotik_transport ENUM('auto','ssh','api') DEFAULT 'auto' AFTER mikrotik_api_tls,
  ADD COLUMN routeros_version VARCHAR(20) AFTER mikrotik_transport,
  ADD COLUMN mikrotik_template_id INT UNSIGNED AFTER routeros_version,
  ADD CONSTRAINT fk_devices_mt_template FOREIGN KEY (mikrotik_template_id) REFERENCES mikrotik_templates(id) ON DELETE SET NULL;
```

> **Remember:** Update `database/schema.sql` and the README database tables section after each migration.

---

## Environment Variables

Add to `.env.example`:

```env
# ---- MikroTik Auto-Provisioning ---------------------------------------------
# Master feature flag — set to true to enable all MikroTik SSH/API features
# FEATURE_MIKROTIK=true

# Default SSH credentials (can be overridden per-device)
# MIKROTIK_DEFAULT_USERNAME=admin
# MIKROTIK_DEFAULT_PASSWORD=

# Connection timeouts (ms)
# MIKROTIK_SSH_TIMEOUT=10000
# MIKROTIK_API_TIMEOUT=10000

# Connection pool settings
# MIKROTIK_POOL_MAX_IDLE_MS=60000
# MIKROTIK_POOL_MAX_CONNECTIONS=50

# Health check polling interval (seconds)
# MIKROTIK_HEALTH_INTERVAL=60

# Config backup interval (hours)
# MIKROTIK_BACKUP_INTERVAL_HOURS=24

# Max concurrent provisioning operations
# MIKROTIK_PROVISIONING_CONCURRENCY=5
```

---

## NPM Dependencies

Add to `package.json` `dependencies`:

```json
"ssh2": "^1.16.0"
```

> The REST API client should use Node 18's built-in `fetch` — no additional HTTP library needed.

---

## API Endpoints

All endpoints are under `/api/v1/mikrotik/` and require authentication + `mikrotik.manage` permission.

| Method | Path | Description |
|--------|------|-------------|
| **Connection** | | |
| POST | `/mikrotik/devices/:id/test-connection` | Test SSH & API connectivity |
| GET | `/mikrotik/devices/:id/system-info` | Get RouterOS version, board, uptime |
| **Templates** | | |
| GET | `/mikrotik/templates` | List templates |
| POST | `/mikrotik/templates` | Create template |
| GET | `/mikrotik/templates/:id` | Get template |
| PUT | `/mikrotik/templates/:id` | Update template |
| DELETE | `/mikrotik/templates/:id` | Delete template |
| POST | `/mikrotik/templates/:id/preview` | Render template with variables (dry run) |
| **Provisioning** | | |
| POST | `/mikrotik/devices/:id/provision` | Apply template to device |
| POST | `/mikrotik/devices/:id/provision/pppoe` | Configure PPPoE server |
| POST | `/mikrotik/devices/:id/provision/radius` | Configure RADIUS client |
| POST | `/mikrotik/devices/:id/provision/firewall` | Apply default firewall |
| POST | `/mikrotik/devices/:id/provision/queues` | Sync queues from plans |
| POST | `/mikrotik/devices/:id/provision/dhcp` | Configure DHCP server |
| POST | `/mikrotik/devices/:id/provision/ip-pools` | Sync IP pools |
| **Operations** | | |
| GET | `/mikrotik/devices/:id/pppoe/sessions` | List active PPPoE sessions |
| POST | `/mikrotik/devices/:id/pppoe/disconnect` | Disconnect a session |
| GET | `/mikrotik/devices/:id/queues` | List queues |
| GET | `/mikrotik/devices/:id/dhcp/leases` | List DHCP leases |
| GET | `/mikrotik/devices/:id/interfaces` | List interfaces with traffic |
| GET | `/mikrotik/devices/:id/firewall/rules` | List firewall rules |
| **Monitoring** | | |
| GET | `/mikrotik/devices/:id/health` | Latest health snapshot |
| GET | `/mikrotik/devices/:id/health/history` | Health history (time range) |
| **Backup** | | |
| POST | `/mikrotik/devices/:id/backup` | Create backup now |
| GET | `/mikrotik/devices/:id/backups` | List backups |
| GET | `/mikrotik/devices/:id/backups/:backupId` | Download backup |
| POST | `/mikrotik/devices/:id/restore/:backupId` | Restore backup |
| **Command Logs** | | |
| GET | `/mikrotik/devices/:id/command-logs` | Command history |
| **Firmware** | | |
| GET | `/mikrotik/devices/:id/firmware` | Check for updates |
| POST | `/mikrotik/devices/:id/firmware/upgrade` | Apply firmware update |
| **Raw (advanced)** | | |
| POST | `/mikrotik/devices/:id/exec` | Execute raw SSH command (super_admin only) |
| POST | `/mikrotik/devices/:id/api` | Execute raw API call (super_admin only) |

---

## Dashboard UI Pages

Add the following pages/sections to `public/js/`:

| Page | Location | Features |
|------|----------|----------|
| MikroTik Dashboard | `/mikrotik` | List of MikroTik devices with health status tiles |
| Device Detail | `/mikrotik/:id` | System info, health gauges, interface traffic charts, active sessions |
| Provisioning | `/mikrotik/:id/provision` | Template selector, variable inputs, dry-run preview, apply button |
| Templates | `/mikrotik/templates` | CRUD table for provisioning templates |
| Command Logs | `/mikrotik/:id/logs` | Searchable/filterable table of all commands sent |
| Backups | `/mikrotik/:id/backups` | List, create, restore, download |
| Raw Terminal | `/mikrotik/:id/terminal` | (super_admin) Send raw SSH commands with live output |

---

## Testing Requirements

Each phase must include tests in `tests/`:

| Test File | Coverage |
|-----------|----------|
| `tests/mikrotik/sshClient.test.js` | Connection, exec, batch with rollback, timeout handling |
| `tests/mikrotik/apiClient.test.js` | REST methods, error handling, TLS options |
| `tests/mikrotik/provisioningEngine.test.js` | Template rendering, variable substitution, rollback flow |
| `tests/mikrotik/pppoeService.test.js` | Add/remove secrets, profile sync, session management |
| `tests/mikrotik/queueService.test.js` | Simple queue CRUD, queue tree, PCQ |
| `tests/mikrotik/firewallService.test.js` | Default rules, NAT, address lists |
| `tests/mikrotik/radiusSetupService.test.js` | RADIUS client config, CoA enable |
| `tests/mikrotik/ipPoolService.test.js` | Pool sync, DHCP config |
| `tests/mikrotik/monitorService.test.js` | Health check parsing, snapshot storage |
| `tests/mikrotik/backupService.test.js` | Backup creation, storage, restore |
| `tests/mikrotik/controller.test.js` | API endpoint tests (auth, validation, RBAC) |

**Test strategy:** Use Jest mocks for SSH/API connections. Create a `tests/mikrotik/__mocks__/MikrotikSSHClient.js` and `MikrotikAPIClient.js` that return predictable MikroTik-formatted responses. Integration tests against real MikroTik hardware are optional and should be gated behind `MIKROTIK_TEST_HOST` env var.

---

## Security Considerations

1. **Credential encryption** — All MikroTik passwords stored in `devices.mikrotik_password` MUST use AES-256-GCM encryption via the existing `ENCRYPTION_KEY`. Follow the same pattern as `PaymentGateway` secret storage.

2. **RBAC permission** — Add a new permission: `mikrotik.manage` (and optionally `mikrotik.view`, `mikrotik.exec_raw`). Only users with this permission can access MikroTik endpoints.

3. **Rate limiting** — Apply a strict rate limit to provisioning endpoints (max 10 req/min per device) to prevent accidental mass-reconfiguration.

4. **Command injection** — All template variable values MUST be sanitized. No shell metacharacters (`; | & $ \` \n`) may pass through to SSH commands. Validate with a strict regex: `/^[a-zA-Z0-9._\-\/=: @]+$/`.

5. **Audit logging** — Every MikroTik command must be logged to `mikrotik_command_logs` with the user who initiated it.

6. **Raw exec restriction** — The `/exec` and `/api` raw endpoints must be limited to `super_admin` role only. All raw commands are logged.

7. **SSH key support** — Support both password and private key authentication. Keys should be stored encrypted.

---

## Conventions & Rules

1. **Follow existing code style** — semicolons, single quotes, 2-space indent, trailing commas (see `CONTRIBUTING.md`).
2. **All new files** go in `src/services/mikrotik/` unless they are models, controllers, routes, or middleware.
3. **Feature flag guard** — Every MikroTik route must check `process.env.FEATURE_MIKROTIK === 'true'` before loading. If disabled, return 404.
4. **Conventional commits** — Use `feat(mikrotik):`, `fix(mikrotik):`, `test(mikrotik):` prefixes.
5. **Error handling** — Use the existing `AppError` class from `src/utils/errors.js`. SSH timeouts → 504. Auth failures → 502. Invalid template → 422.
6. **Logging** — Use `require('../utils/logger').child({ service: 'mikrotik' })`.
7. **Database** — Update `database/schema.sql` and `README.md` database tables for every migration.
8. **Tests** — Every PR must maintain or increase test coverage. No phase is complete without its test file.
9. **No breaking changes** — The MikroTik subsystem is purely additive. Existing RADIUS, SNMP, and billing functionality must not be affected.

---

## Phase Execution Order

| Phase | Depends On | Priority |
|-------|-----------|----------|
| 1 — Connection Layer | — | 🔴 Critical (blocks all) |
| 2 — Templates | Phase 1 | 🔴 Critical |
| 3 — PPPoE | Phase 1 | 🟡 High |
| 4 — Queues | Phase 1 | 🟡 High |
| 5 — Firewall/NAT | Phase 1 | 🟡 High |
| 6 — RADIUS on MikroTik | Phase 1 | 🟡 High |
| 7 — IP Pools / DHCP | Phase 1 | 🟢 Medium |
| 8 — Monitoring | Phase 1 | 🟢 Medium |
| 9 — Backup/Restore | Phase 1 | 🟢 Medium |
| 10 — Firmware | Phase 1 | 🔵 Low |

Phases 3–6 can be worked on **in parallel** once Phase 1 is merged.

---

*Last updated: 2026-04-14*