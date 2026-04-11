# FireRelay — Architecture Specification

FireISP 5.0's built-in multi-node clustering system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Operating Modes](#2-operating-modes)
   - 2.1 [Standalone (default)](#21-standalone-default)
   - 2.2 [Master](#22-master)
   - 2.3 [Worker](#23-worker)
3. [Architecture Diagrams](#3-architecture-diagrams)
   - 3.1 [Standalone Mode](#31-standalone-mode)
   - 3.2 [Clustered Mode (Master + Workers)](#32-clustered-mode-master--workers)
   - 3.3 [Adding a New Node](#33-adding-a-new-node)
   - 3.4 [Request Routing Flow](#34-request-routing-flow)
4. [Key Design Decisions](#4-key-design-decisions)
   - 4.1 [Capacity-Based, Not Region-Based](#41-capacity-based-not-region-based)
   - 4.2 [ID Collision Prevention](#42-id-collision-prevention)
   - 4.3 [Central Registry on Master](#43-central-registry-on-master)
   - 4.4 [Same Codebase Everywhere](#44-same-codebase-everywhere)
   - 4.5 [Request Routing Patterns](#45-request-routing-patterns)
   - 4.6 [Node Health Monitoring](#46-node-health-monitoring)
   - 4.7 [Node Lifecycle](#47-node-lifecycle)
   - 4.8 [Failure Handling](#48-failure-handling)
5. [Configuration Reference](#5-configuration-reference)
6. [Future File Structure](#6-future-file-structure)
7. [Scaling Roadmap](#7-scaling-roadmap)
8. [Implementation Priority](#8-implementation-priority)

---

## 1. Overview

FireRelay is FireISP's built-in node relay system. It allows multiple FireISP servers to work together as one unified system, all controlled from a single web dashboard.

**The core principle:** Every FireISP installation ships with FireRelay code already present. By default it sleeps in `standalone` mode — a single server acts as though FireRelay does not exist, with zero performance overhead. When a second server is needed, the operator flips a single `.env` variable on the first node to `master`, stands up a new machine with the same codebase pointing back to the master, and the cluster is live.

FireRelay is designed for **capacity-based horizontal scaling**. When a node reaches its client or device limits, a new node is added and the system continues operating seamlessly. No data migration is required; existing clients stay on the node that owns them.

---

## 2. Operating Modes

FireRelay operates in exactly one of three modes, controlled by the environment variable `FIRERELAY_MODE`.

### 2.1 `standalone` (default)

Every FireISP installation starts here.

- A single server handles all requests locally.
- FireRelay is present in the codebase but entirely inactive — requests pass straight through to the local application.
- No node registry, no health checks, no proxying.
- Zero performance overhead — the middleware is a single conditional check that short-circuits immediately.

Switch to `master` only when you need to add a second server.

### 2.2 `master`

The first node becomes the central relay point for the cluster.

- Continues to run its own local FireISP instance (handles its own clients, devices, SNMP polling, invoices, etc.).
- Maintains a **node registry** — a lightweight lookup of all worker nodes (name, API URL, current status, capacity metrics).
- Maintains a **client routing table** — maps every `client_id` to the node that owns it.
- Routes incoming requests to the correct node based on the routing table.
- Fans out search/list queries to all nodes, merges results, and returns a combined response to the dashboard.
- Assigns new clients to the least-loaded node.
- Monitors the health of all worker nodes at a configurable interval.

### 2.3 `worker`

All nodes beyond the first run as workers.

- Handles only its own local data (clients, devices, SNMP polling, scheduled tasks, etc.).
- Exposes the same API endpoints as any FireISP node, plus a dedicated `GET /api/firerelay/health` endpoint.
- Reports health and capacity metrics to the master.
- Does **not** know about other workers — it only knows about the master.
- Runs the exact same codebase as the master node. The only difference is the `.env` configuration.

---

## 3. Architecture Diagrams

### 3.1 Standalone Mode

```
┌─────────────────────────────────────────┐
│           FireISP Node (standalone)     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  FireRelay Middleware           │   │
│  │  mode: "standalone"             │   │
│  │  → pass-through (no-op)         │   │
│  └────────────────┬────────────────┘   │
│                   │                    │
│  ┌────────────────▼────────────────┐   │
│  │  Application Layer              │   │
│  │  (controllers, services,        │   │
│  │   models, routes)               │   │
│  └────────────────┬────────────────┘   │
│                   │                    │
│  ┌────────────────▼────────────────┐   │
│  │  MySQL Database                 │   │
│  │  (all clients, all devices,     │   │
│  │   all data)                     │   │
│  └─────────────────────────────────┘   │
│                                         │
│  FireRelay: SLEEPING                    │
└─────────────────────────────────────────┘
```

### 3.2 Clustered Mode (Master + Workers)

```
                    Browser / Dashboard
                           │
                           ▼
┌──────────────────────────────────────────┐
│        FireISP Node 1  (MASTER)          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  FireRelay Middleware              │  │
│  │  mode: "master"                   │  │
│  │                                   │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │  Node Registry               │ │  │
│  │  │  node2 → https://node2:3000  │ │  │
│  │  │  node3 → https://node3:3000  │ │  │
│  │  └──────────────────────────────┘ │  │
│  │                                   │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │  Client Routing Table        │ │  │
│  │  │  client_id 1–10000   → self  │ │  │
│  │  │  client_id 10000001+ → node2 │ │  │
│  │  │  client_id 20000001+ → node3 │ │  │
│  │  └──────────────────────────────┘ │  │
│  └───────┬──────────────┬────────────┘  │
│          │              │               │
│          ▼              │               │
│  ┌───────────────┐      │               │
│  │  Local App    │      │               │
│  │  + MySQL      │      │               │
│  │  (Node 1      │      │               │
│  │   clients)    │      │               │
│  └───────────────┘      │               │
└─────────────────────────┼───────────────┘
                          │ HTTP (proxied requests)
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Node 2      │  │  Node 3      │  │  Node N      │
│  (WORKER)    │  │  (WORKER)    │  │  (WORKER)    │
│              │  │              │  │              │
│  Local App   │  │  Local App   │  │  Local App   │
│  + MySQL     │  │  + MySQL     │  │  + MySQL     │
│  (its own    │  │  (its own    │  │  (its own    │
│   clients)   │  │   clients)   │  │   clients)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 3.3 Adding a New Node

```
Step 1: Current state — Node 1 is at capacity

  ┌─────────────────────────────────┐
  │  Node 1 (master)                │
  │  Clients: 9,847 / 10,000 (98%) │  ← Nearly full
  │  Devices: 2,891 / 3,000  (96%) │
  └─────────────────────────────────┘

Step 2: Provision Node 2 — same codebase, different .env

  .env on Node 2:
    FIRERELAY_MODE=worker
    FIRERELAY_MASTER_URL=https://node1.fireisp.com
    FIRERELAY_NODE_ID=node2
    FIRERELAY_AUTO_INCREMENT_OFFSET=10000001

Step 3: Register Node 2 on the master

  .env on Node 1 (update):
    FIRERELAY_MODE=master
    FIRERELAY_NODES=["https://node2.fireisp.com"]

Step 4: Cluster is live — new clients go to Node 2

  ┌─────────────────────────────────┐     ┌───────────────────────────────┐
  │  Node 1 (master)                │────▶│  Node 2 (worker)              │
  │  Clients: 9,847 / 10,000 (98%) │     │  Clients:    0 / 10,000  (0%) │
  │  Devices: 2,891 / 3,000  (96%) │     │  Devices:    0 / 3,000   (0%) │
  └─────────────────────────────────┘     └───────────────────────────────┘
  ↑ Existing clients stay here            ↑ All new clients go here
```

### 3.4 Request Routing Flow

```
Browser sends: GET /api/clients/15432
                         │
                         ▼
            ┌────────────────────────┐
            │  Master: FireRelay     │
            │  Middleware            │
            │                       │
            │  1. Parse client_id   │
            │     from path: 15432  │
            │                       │
            │  2. Lookup routing    │
            │     table:            │
            │     15432 → node2     │
            │                       │
            │  3. Proxy request     │
            │     to node2          │
            └───────────┬───────────┘
                        │
                        │  GET /api/clients/15432
                        │  (internal HTTP call)
                        ▼
            ┌────────────────────────┐
            │  Node 2: Worker        │
            │                       │
            │  Handles request       │
            │  locally, returns      │
            │  JSON response         │
            └───────────┬───────────┘
                        │
                        │  { id: 15432, name: "..." }
                        │
                        ▼
            ┌────────────────────────┐
            │  Master: FireRelay     │
            │  Middleware            │
            │                       │
            │  Returns worker        │
            │  response to browser   │
            └───────────┬───────────┘
                        │
                        ▼
                     Browser
```

---

## 4. Key Design Decisions

### 4.1 Capacity-Based, Not Region-Based

Nodes are added when capacity is needed, not tied to geography. A client belongs to whichever node had space when they were created — not whichever region they are in. This keeps the system simple: no geo-routing tables, no regional configuration, no concept of zones.

When Node 1 reaches its client limit, Node 2 is added and starts taking new clients. Node 1's existing clients stay on Node 1.

### 4.2 ID Collision Prevention

Because each node has its own independent MySQL database, `AUTO_INCREMENT` IDs would collide across nodes if left at the default. FireRelay assigns each node an `AUTO_INCREMENT` offset so IDs are globally unique:

| Node | `AUTO_INCREMENT` Offset | ID Range |
|------|------------------------|--------------------------|
| Node 1 | 1 | 1 → 10,000,000 |
| Node 2 | 10,000,001 | 10,000,001 → 20,000,000 |
| Node 3 | 20,000,001 | 20,000,001 → 30,000,000 |
| Node N | (N−1) × 10,000,001 | Up to 10 million records per table |

Each node has room for 10 million records per table. At that scale, an additional node would be added long before hitting this limit.

The offset is set via the `FIRERELAY_AUTO_INCREMENT_OFFSET` environment variable and applied to all tables during database initialization on the worker node.

### 4.3 Central Registry on Master

The master maintains two lightweight lookup structures in its own database:

**`nodes` table** — list of all worker nodes:

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR | Unique node identifier (e.g. `node2`) |
| `name` | VARCHAR | Human-readable name |
| `api_url` | VARCHAR | Base URL of the node's API |
| `status` | ENUM | `active`, `draining`, `maintenance`, `offline` |
| `client_count` | INT | Last reported client count |
| `device_count` | INT | Last reported device count |
| `last_seen_at` | DATETIME | Timestamp of last successful health check |

**`client_routing` table** — maps each `client_id` to the node that owns it:

| Column | Type | Description |
|--------|------|-------------|
| `client_id` | BIGINT | The client's ID |
| `node_id` | VARCHAR | Which node owns this client |

These two tables are the only FireRelay-specific additions to the master's database. All other tables are standard FireISP tables.

### 4.4 Same Codebase Everywhere

Every node — master and workers — runs the exact same FireISP application code from the same repository. There is no "master build" or "worker build." The only difference between nodes is the `.env` configuration file. This means:

- Deploying a new worker is identical to deploying any FireISP instance.
- There is no version mismatch problem to manage.
- Debugging is straightforward — the same code runs everywhere.
- Rolling updates can be applied node by node.

### 4.5 Request Routing Patterns

FireRelay handles four categories of requests differently:

| Request Type | Example | Routing Behaviour |
|--------------|---------|-------------------|
| **Single-entity lookup** | `GET /api/clients/5432` | Master looks up which node owns `client_id=5432`, proxies the request to that node, returns the response. |
| **Search / list query** | `GET /api/clients?search=John` | Master fans out the request to **all** nodes simultaneously, collects results, merges and sorts them, returns a combined list. |
| **Create operation** | `POST /api/clients` | Master selects the least-loaded `active` node, routes the creation request there, records the `client_id → node` mapping in the routing table. |
| **Local operations** | SNMP polling, scheduled tasks, billing runs | Each node handles its own devices and tasks locally. These are never proxied. The existing `scheduled_tasks.locked_by` column is used for distributed locking within a single node. |

### 4.6 Node Health Monitoring

The master polls each worker at the interval defined by `FIRERELAY_HEALTH_INTERVAL` (default 30 seconds). Workers expose a dedicated endpoint:

```
GET /api/firerelay/health
```

Response payload:

```json
{
  "node_id": "node2",
  "status": "active",
  "client_count": 4821,
  "device_count": 1203,
  "cpu_percent": 34.2,
  "memory_percent": 61.8,
  "disk_percent": 47.5,
  "db_size_mb": 2048,
  "uptime_seconds": 1209600,
  "timestamp": "2025-06-15T14:32:00Z"
}
```

The master stores the latest health snapshot and uses `client_count` and `device_count` to determine the least-loaded node when routing new client creation requests.

### 4.7 Node Lifecycle

Each worker node passes through the following lifecycle states, stored in the `nodes.status` column on the master:

```
  ┌──────────┐
  │  active  │◄──── default state when a node joins
  └────┬─────┘
       │  operator sets status = draining
       ▼
  ┌──────────┐
  │ draining │  still handles existing clients
  └────┬─────┘  master stops assigning new clients here
       │  operator takes node offline
       ▼
  ┌─────────────┐
  │ maintenance │  temporarily offline
  └────┬────────┘  master skips for all new assignments
       │  health checks fail
       ▼
  ┌─────────┐
  │ offline │  unreachable, marked after N failed health checks
  └─────────┘
```

| Status | New Clients Assigned | Existing Clients Served | Health Checked |
|--------|---------------------|------------------------|----------------|
| `active` | ✅ Yes | ✅ Yes | ✅ Yes |
| `draining` | ❌ No | ✅ Yes | ✅ Yes |
| `maintenance` | ❌ No | ⚠️ Best effort | ✅ Yes |
| `offline` | ❌ No | ❌ No (returns warning) | ✅ Yes (to recover) |

### 4.8 Failure Handling

If a worker node is unreachable when the master needs to proxy a request to it:

1. **Retry** — The master retries the request 3 times (configurable via `FIRERELAY_MAX_RETRIES`) with exponential backoff.
2. **Mark offline** — After all retries fail, the master updates `nodes.status = 'offline'` for that node.
3. **Partial results** — For fan-out queries (search/list), the master returns results from all reachable nodes along with a warning: `"Node node2 is unreachable — results may be incomplete."`
4. **No client reassignment** — The master does **not** reassign clients from the offline node to other nodes. The data still lives on that node's database. When the node comes back online, its clients are served normally and the master resets its status to `active`.

This is a deliberate design choice: client data is not replicated, so there is no safe way to "move" a client to another node without risking data inconsistency. Operators are expected to restore the offline node rather than migrate its data.

---

## 5. Configuration Reference

All FireRelay settings are controlled via environment variables in the node's `.env` file.

```env
# ─────────────────────────────────────────────
# FireRelay Mode
# standalone | master | worker
# Default: standalone
# ─────────────────────────────────────────────
FIRERELAY_MODE=standalone

# ─────────────────────────────────────────────
# Master-only settings
# (ignored when FIRERELAY_MODE=standalone or worker)
# ─────────────────────────────────────────────

# JSON array of worker node base URLs
# Example: ["https://node2.fireisp.com","https://node3.fireisp.com"]
FIRERELAY_NODES=[]

# How often the master polls each worker for health metrics (milliseconds)
# Default: 30000 (30 seconds)
FIRERELAY_HEALTH_INTERVAL=30000

# Timeout for proxied requests to worker nodes (milliseconds)
# Default: 5000 (5 seconds)
FIRERELAY_REQUEST_TIMEOUT=5000

# Number of retries before marking a worker node as offline
# Default: 3
FIRERELAY_MAX_RETRIES=3

# ─────────────────────────────────────────────
# Worker-only settings
# (ignored when FIRERELAY_MODE=standalone or master)
# ─────────────────────────────────────────────

# Base URL of the master node (used for registration and reporting)
FIRERELAY_MASTER_URL=

# Unique identifier for this node (e.g. node2, node3)
FIRERELAY_NODE_ID=

# Starting AUTO_INCREMENT value for all tables on this node
# Node 1: 1  |  Node 2: 10000001  |  Node 3: 20000001
FIRERELAY_AUTO_INCREMENT_OFFSET=1

# ─────────────────────────────────────────────
# Capacity thresholds (all nodes)
# Master uses these to decide when a node is "full"
# and should no longer receive new client assignments.
# ─────────────────────────────────────────────

# Maximum number of clients before this node is considered full
# Default: 10000
FIRERELAY_MAX_CLIENTS=10000

# Maximum number of devices before this node is considered full
# Default: 3000
FIRERELAY_MAX_DEVICES=3000
```

**Example — single server (default):**

```env
FIRERELAY_MODE=standalone
```

**Example — Node 1 promoted to master after adding Node 2:**

```env
FIRERELAY_MODE=master
FIRERELAY_NODES=["https://node2.fireisp.com"]
FIRERELAY_HEALTH_INTERVAL=30000
FIRERELAY_REQUEST_TIMEOUT=5000
FIRERELAY_MAX_RETRIES=3
FIRERELAY_MAX_CLIENTS=10000
FIRERELAY_MAX_DEVICES=3000
```

**Example — Node 2 as a worker:**

```env
FIRERELAY_MODE=worker
FIRERELAY_MASTER_URL=https://node1.fireisp.com
FIRERELAY_NODE_ID=node2
FIRERELAY_AUTO_INCREMENT_OFFSET=10000001
FIRERELAY_MAX_CLIENTS=10000
FIRERELAY_MAX_DEVICES=3000
```

---

## 6. Future File Structure

When FireRelay is implemented (Step 5 of the roadmap), it will add the following files to the existing `src/` tree. All other application files remain unchanged.

```
src/
├── config/
│   └── firerelay.js           ← Reads FIRERELAY_MODE and all FIRERELAY_* vars
│                                 from .env. Exports a single config object.
│                                 (~30 lines)
│
├── middleware/
│   └── firerelay.js           ← Express middleware mounted before all routes.
│                                 In standalone mode: calls next() immediately.
│                                 In master mode: inspects the request, looks up
│                                 the routing table, proxies or fans out as needed.
│                                 In worker mode: calls next() (requests arrive
│                                 already routed from the master).
│                                 (~200 lines)
│
├── services/
│   └── firerelayService.js    ← Node registry management, health check polling
│                                 loop, routing table CRUD, least-loaded-node
│                                 selection, fan-out merge logic, retry/backoff.
│                                 (~300 lines)
│
├── routes/
│   └── firerelay.js           ← /api/firerelay/* endpoints:
│                                   GET  /api/firerelay/health    (worker: reports metrics)
│                                   GET  /api/firerelay/nodes     (master: lists all nodes)
│                                   POST /api/firerelay/nodes     (master: register a node)
│                                   PUT  /api/firerelay/nodes/:id (master: update node status)
│                                 (~80 lines)
│
├── controllers/               ← Unchanged — no FireRelay awareness needed here
├── models/                    ← Unchanged
└── ... (rest of app unchanged)
```

The master's database will also receive two additional migration files when FireRelay is built:

```
database/migrations/
├── NNN_create_firerelay_nodes_table.sql
│     → nodes table (id, name, api_url, status, client_count,
│                    device_count, last_seen_at)
└── NNN_create_firerelay_client_routing_table.sql
│     → client_routing table (client_id BIGINT, node_id VARCHAR)
```

These migrations run only on the master node. Worker nodes do not need them.

---

## 7. Scaling Roadmap

FireRelay becomes relevant at the 30K-client threshold. Below that, a single well-tuned server handles everything.

| Scale | Architecture | FireRelay Mode | Notes |
|-------|-------------|----------------|-------|
| 0–10K clients | Single server | `standalone` | Default configuration. No changes needed. |
| 10K–30K clients | Single server (optimised) | `standalone` | Add indexes, tune MySQL, increase server RAM before adding nodes. |
| 30K–50K clients | Master + 1 worker | `master` + `worker` | Flip `FIRERELAY_MODE=master` on Node 1. Provision Node 2. |
| 50K–100K clients | Master + 2–3 workers | `master` + `worker` × N | Add Node 3, Node 4. Each addition is identical to adding Node 2. |
| 100K+ clients | Dedicated relay master + workers | `master` (relay-only) + `worker` × N | At this scale, consider a master that holds no client data of its own and acts purely as a relay. Node 1 becomes a worker too. |

---

## 8. Implementation Priority

FireRelay is **Step 5** in the FireISP 5.0 development roadmap. It must not be built before the core application exists — there is nothing to relay without it.

| Step | What | Status |
|------|------|--------|
| 1 | Database schema (migrations) | ✅ Complete — 118 migrations, 101 tables |
| 2 | Node.js application scaffold (`package.json`, `server.js`, database connection) | 🔲 Next |
| 3 | Authentication (login, logout, sessions) | 🔲 Pending |
| 4 | Core CRUD modules (clients, plans, invoices, devices, tickets, etc.) | 🔲 Pending |
| **5** | **FireRelay** ← this document describes what will be built here | 🔲 Pending |

> **Note:** FireRelay's `standalone` mode middleware should be included from the very beginning of Step 2 — it is a ~30-line pass-through that costs nothing and avoids a larger refactor later. Steps 3 and 4 proceed as if FireRelay does not exist. Only Step 5 implements the actual relay logic.

---

*Document created: 2025 — FireISP 5.0 project.*
*This is a design specification. No application code has been written yet.*
