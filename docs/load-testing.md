# Load Testing — Roadmap 4.1

This page describes how to run the FireISP API load test that satisfies
roadmap milestone **4.1 — Infrastructure** ("Load test API with realistic
ISP workload (500 clients, 5000 invoices, 100 devices)").

The load test is implemented as a thin [autocannon](https://github.com/mcollina/autocannon)
wrapper that authenticates once with a load-test admin user and then drives
sustained read traffic against the most-hit endpoints (health probe,
single-record reads, paginated list reads).

## TL;DR

```bash
# 0. Start MySQL and the API as you normally would (locally, or against a
#    staging environment), with a JWT_SECRET set and rate limits bumped:
RATE_LIMIT_API=10000000 RATE_LIMIT_AUTH=10000000 \
  JWT_SECRET=<at-least-64-chars> npm start

# 1. Insert the 500 / 5000 / 100 fixture into the configured DB:
npm run loadtest:seed

# 2. Run the load test against the running API:
LOADTEST_URL=http://127.0.0.1:3000 npm run loadtest
```

The load test prints a per-scenario table to stdout and emits structured JSON
log lines (Pino) for each scenario plus an aggregate summary at the end.
Exit code is non-zero if any scenario sees network errors, timeouts, or 5xx
responses — so the script can be wired into CI as a gate.

## What gets seeded

`npm run loadtest:seed` (`src/scripts/loadtest-seed.js`) creates a dedicated
load-test organization (`Load Test ISP (4.1)`) and inserts:

| Entity        | Count | Notes                                                         |
|---------------|------:|---------------------------------------------------------------|
| organizations |     1 | Scoping container for everything below; safe to re-seed.      |
| users         |     1 | Admin user (`loadtest@fireisp.local` / `loadtest123!`).        |
| sites         |     1 | One POP site referenced by every contract and device.         |
| plans         |     1 | One plan referenced by every contract.                        |
| clients       |   500 | `Load Client 1`…`Load Client 500`, mostly personal.           |
| contracts     |   500 | One active PPPoE contract per client.                         |
| invoices      | 5,000 | Round-robin across clients; mix of draft/sent/paid/overdue.   |
| devices       |   100 | POP devices (router/switch/ptp/ptmp_ap/olt rotation).         |

The script is **idempotent**: if the load-test organization already exists it
is wiped (cascading through invoices, devices, contracts, clients, plans,
sites, organization_users, users) and recreated, so you always get a fresh
fixture. All inserts use chunked multi-row `INSERT` (batch size 500), so the
full 6,100-row fixture seeds in well under a second on a local MySQL.

Override the volume with environment variables when you need a smaller smoke
or a larger soak:

```bash
LOADTEST_CLIENTS=100 LOADTEST_INVOICES=1000 LOADTEST_DEVICES=20 \
  npm run loadtest:seed
```

## What the load test runs

`npm run loadtest` (`src/scripts/loadtest.js`) does the following:

1. POSTs to `/api/v1/auth/login` with the seeded admin credentials and
   captures the JWT access token.
2. Runs each scenario sequentially with the configured concurrency
   (`LOADTEST_CONNECTIONS`, default 25) for the configured duration
   (`LOADTEST_DURATION`, default 10 seconds).
3. For each scenario, records: req/sec, p50/p90/p97.5/p99/max latency,
   bytes/sec, and the count of 1xx/2xx/3xx/4xx/5xx responses.
4. Prints a final aggregate (total requests, error rate, worst p99 across
   all scenarios) and exits non-zero if any scenario observed network
   errors, timeouts, or 5xx responses.

### Default scenarios

| #  | Path                                  | Purpose                                            |
|----|---------------------------------------|----------------------------------------------------|
| 1  | `GET /health`                         | No-auth baseline (TLS + middleware only).          |
| 2  | `GET /api/v1/clients/1`               | Single-record DB read, lowest id.                  |
| 3  | `GET /api/v1/clients/250`             | Single-record DB read, mid-range id.               |
| 4  | `GET /api/v1/clients/500`             | Single-record DB read, last id.                    |
| 5  | `GET /api/v1/clients?page=1&limit=50` | Paginated list (uses `BaseModel.findAll`).         |
| 6  | `GET /api/v1/invoices?page=1&limit=50`| Paginated list — heaviest table at 5,000 rows.     |
| 7  | `GET /api/v1/devices?page=1&limit=50` | Paginated list — POP devices.                      |

## Configuration reference

All settings are environment variables; defaults are in parentheses.

| Variable               | Used by    | Default                       | Description                                      |
|------------------------|------------|-------------------------------|--------------------------------------------------|
| `LOADTEST_CLIENTS`     | seed       | `500`                         | Number of clients to insert.                     |
| `LOADTEST_INVOICES`    | seed       | `5000`                        | Number of invoices to insert.                    |
| `LOADTEST_DEVICES`     | seed       | `100`                         | Number of devices to insert.                     |
| `LOADTEST_EMAIL`       | seed + run | `loadtest@fireisp.local`      | Admin login email.                               |
| `LOADTEST_PASSWORD`    | seed + run | `loadtest123!`                | Admin login password.                            |
| `LOADTEST_URL`         | run        | `http://127.0.0.1:3000`       | API base URL.                                    |
| `LOADTEST_DURATION`    | run        | `10`                          | Seconds per scenario.                            |
| `LOADTEST_CONNECTIONS` | run        | `25`                          | Concurrent autocannon connections.               |
| `LOADTEST_PIPELINING`  | run        | `1`                           | Pipelined requests per connection.               |
| `RATE_LIMIT_API`       | server     | `200`                         | **Bump for load tests.** Otherwise `429`s storm. |
| `RATE_LIMIT_AUTH`      | server     | `20`                          | Bump for load tests.                             |
| `DB_POOL_SIZE`         | server     | `20`                          | Increase if `connections` exceeds this number.   |

## Sample run

A representative run on a laptop-class machine (MySQL 8 + Node.js 24, 20
connections, 8s per scenario):

```
=== FireISP 4.1 Load Test — Summary ===
  GET /health (baseline, no auth)             3883 req/s  p50=   4ms  p97.5=   9ms  p99=  11ms  2xx=31060  4xx=0  5xx=0  errors=0
  GET /clients/1 (single record)              1066 req/s  p50=  18ms  p97.5=  25ms  p99=  27ms  2xx=8527   4xx=0  5xx=0  errors=0
  GET /clients/250 (mid-range id)             1118 req/s  p50=  17ms  p97.5=  23ms  p99=  24ms  2xx=8940   4xx=0  5xx=0  errors=0
  GET /clients/500 (last id)                  1143 req/s  p50=  17ms  p97.5=  22ms  p99=  23ms  2xx=9146   4xx=0  5xx=0  errors=0
  GET /clients (list, page 1)                  914 req/s  p50=  20ms  p97.5=  30ms  p99=  35ms  2xx=0      4xx=0  5xx=7315  errors=0
  GET /invoices (list, page 1)                1086 req/s  p50=  17ms  p97.5=  23ms  p99=  24ms  2xx=0      4xx=0  5xx=8684  errors=0
  GET /devices (list, page 1)                 1084 req/s  p50=  17ms  p97.5=  23ms  p99=  24ms  2xx=0      4xx=0  5xx=8671  errors=0
  ----
  total requests = 82343, error rate = 29.96%, worst p99 = 35ms
```

## Findings from the first run

The first sustained load test against a real MySQL surfaced one regression
that unit tests (which mock `db.query`) cannot catch:

* **Paginated list endpoints fail with a 500.** `BaseModel.findAll` (and a
  couple of similar callers in `alertService` and `firerelayService`) build
  `LIMIT ? OFFSET ?` and dispatch the statement through `db.query`, which
  internally uses `pool.execute` (the binary prepared-statement protocol).
  MySQL does **not** accept `LIMIT` / `OFFSET` placeholders over the
  prepared-statement protocol, so every paginated read returns
  `ER_WRONG_ARGUMENTS — Incorrect arguments to mysqld_stmt_execute`.

  Reproduction (any list endpoint with pagination):
  ```bash
  curl -H "authorization: Bearer $TOKEN" \
    'http://127.0.0.1:3000/api/v1/clients?page=1&limit=50'
  # → 500 INTERNAL_ERROR
  ```

  Single-record `GET /:id` lookups, which do not use `LIMIT/OFFSET`, are
  unaffected and serve ~1,100 req/s with sub-30 ms p99 latency.

  This is filed as a follow-up bug; it should be fixed in its own PR
  (per the roadmap rule "one PR = one checklist item").

Beyond that one finding, the API sustains ~3,900 req/s on the static
`/health` baseline and ~1,000 req/s on indexed single-record DB reads with
p99 latency under 35 ms — comfortably above the "realistic ISP workload"
the 4.1 milestone calls for.

---

## Running against the production docker-compose stack (P1.6)

**P1.6 of `ROADMAP_PRODUCTION.md`** requires verifying the load test
against the full production stack, not just the dev API.

### Start the production stack

```bash
# Copy and fill in all secrets:
cp .env.example .env
# Edit .env — set JWT_SECRET (≥ 64 chars), ENCRYPTION_KEY, DB_PASSWORD, etc.

# Start MySQL primary, Redis, app, and Nginx:
RATE_LIMIT_API=10000000 RATE_LIMIT_AUTH=10000000 \
  docker compose -f docker-compose.prod.yml up -d

# Wait for MySQL to be ready, then run migrations and seed:
docker exec fireisp-app npm run migrate
docker exec fireisp-app npm run seed
docker exec fireisp-app npm run loadtest:seed
```

### Run the standard load test against it

```bash
# Point the load test at the Nginx TLS frontend (or plain HTTP for local):
LOADTEST_URL=https://your-fireisp.domain npm run loadtest
# or locally:
LOADTEST_URL=http://localhost npm run loadtest
```

### Regression budget

The following thresholds define a **passing** load test run.
Exit code 0 from `npm run loadtest` means all assertions below hold:

| Metric | Budget | Rationale |
|---|---|---|
| Error rate (5xx + network errors) | **0%** | Any 5xx under load is a P0 bug |
| p99 latency — single-record reads | **≤ 200 ms** | Well inside SLO-2 (500 ms) with production DB |
| p99 latency — paginated list reads | **≤ 500 ms** | SLO-2 boundary |
| Throughput — `/health` | **≥ 500 req/s** | Validates Nginx + TLS overhead |
| Throughput — list endpoints | **≥ 100 req/s** | Validates DB + connection-pool headroom |

If any threshold is breached, create a P0 issue referencing this file and
do not promote the build to production.

---

## Soak test (P1.6)

The **soak test** runs at a much lower rate than the standard load test but
for a much longer duration. Its purpose is to catch:

- Memory leaks (RSS growth > 100 MB over the session).
- File-descriptor leaks.
- MySQL connection-pool exhaustion over time.
- Token/cache expiry edge cases that only surface after minutes of traffic.

### Quick command

```bash
# 5-minute soak (CI gate — default):
npm run loadtest:soak

# 30-minute soak (pre-release check):
SOAK_TOTAL_DURATION=1800 npm run loadtest:soak

# Full overnight soak (major release):
SOAK_TOTAL_DURATION=86400 SOAK_ROUND_DURATION=60 npm run loadtest:soak
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `LOADTEST_URL` | `http://127.0.0.1:3000` | API base URL |
| `LOADTEST_EMAIL` | `loadtest@fireisp.local` | Auth email (same as standard load test) |
| `LOADTEST_PASSWORD` | `loadtest123!` | Auth password |
| `SOAK_TOTAL_DURATION` | `300` | Total soak duration in seconds |
| `SOAK_ROUND_DURATION` | `30` | Duration of each autocannon round in seconds |
| `SOAK_CONNECTIONS` | `5` | Concurrent connections (low rate by design) |
| `SOAK_MAX_RSS_GROWTH_MB` | `100` | RSS growth budget; violation exits 1 |
| `SOAK_MAX_ERROR_RATE` | `0.005` | Max acceptable error fraction (0.5%) |

### How to interpret results

The soak test prints a table after each round:

```
=== FireISP P1.6 Soak Test — Summary ===
  Duration: 300s / 300s  |  Rounds: 10  |  Connections: 5

  Round  Elapsed   RSS(MB)  ΔRss(MB)   Reqs    Errors  ErrRate  p99(ms)
      1      32s      128       +0    1450        0    0.00%       28
      2      64s      130       +2    1455        0    0.00%       29
    ...
     10     302s      132       +4   14550        0    0.00%       31

  ✓ All soak rounds passed within budget
```

A clean run shows:
- `ΔRss(MB)` stays small and roughly flat after the first few rounds
  (initial growth from JIT compilation / warm-up is expected).
- `ErrRate` is 0.00% throughout.
- `p99(ms)` is stable and below 500 ms.

### Release candidate gate

Run the 5-minute soak as part of the release candidate checklist:

```bash
# After deploying RC to staging:
npm run loadtest:seed   # ensure fixture exists
LOADTEST_URL=https://staging.your-isp.com npm run loadtest:soak
# Exit 0 = soak passed; exit 1 = investigate before promoting to production
```

