# FireISP 5.0 — Grafana Dashboards

This directory contains Grafana dashboard JSON templates for monitoring FireISP 5.0. All dashboards use Prometheus as the data source.

## Dashboards

| File | UID | Title | Purpose |
|---|---|---|---|
| `fireisp-dashboard.json` | `fireisp-app` | Application Dashboard | Process health, HTTP throughput, request latency (p50/p95/p99), memory, DB query p95 |
| `fireisp-api-performance.json` | `fireisp-api-perf` | API Performance | Per-route latency histograms, error rates, error ratio, DB query times by operation |
| `fireisp-network.json` | `fireisp-network` | Network & SNMP | RADIUS request rates, SNMP polling latency, device management activity |
| `fireisp-billing.json` | `fireisp-billing` | Billing & Revenue | Invoice generation, payment processing, billing endpoint latency and errors |
| `fireisp-alerts.json` | `fireisp-alerts` | Alerts & Monitoring | Alert evaluations, webhook delivery, notification latency, audit log writes |

## Metrics Reference

The FireISP metrics endpoint (`GET /metrics`) exposes Prometheus-format metrics at runtime:

| Metric | Type | Description |
|---|---|---|
| `http_requests_total` | counter | Total HTTP requests received |
| `http_request_errors_total` | counter | Total HTTP 4xx/5xx responses |
| `http_request_duration_seconds` | histogram | HTTP request duration by `method` and `path` |
| `db_query_duration_seconds` | histogram | Database query duration by `operation` (SELECT/INSERT/UPDATE/DELETE) |
| `process_uptime_seconds` | gauge | Process uptime |
| `process_resident_memory_bytes` | gauge | RSS memory |
| `process_heap_used_bytes` | gauge | V8 heap used |
| `process_heap_total_bytes` | gauge | V8 heap total |
| `nodejs_active_handles_total` | gauge | Active libuv handles |
| `nodejs_active_requests_total` | gauge | Active libuv requests |

## Importing Dashboards

1. In Grafana, go to **Dashboards → Import**.
2. Upload the JSON file or paste its contents.
3. Select your Prometheus data source when prompted for `DS_PROMETHEUS`.
4. Click **Import**.

## Key PromQL Queries

### API latency p95 (all routes)
```promql
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

### API latency p95 per route
```promql
histogram_quantile(0.95, sum by (le, path) (rate(http_request_duration_seconds_bucket[5m])))
```

### HTTP error ratio
```promql
rate(http_request_errors_total[5m]) / rate(http_requests_total[5m])
```

### DB query latency p95
```promql
histogram_quantile(0.95, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))
```

### DB query latency p95 by operation
```promql
histogram_quantile(0.95, sum by (le, operation) (rate(db_query_duration_seconds_bucket[5m])))
```
