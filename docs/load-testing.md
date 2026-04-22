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
