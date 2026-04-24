# FireISP 5.0 — Service Level Objectives (SLOs) & Alerting (P1.8)

> **Audience:** Operations, on-call engineers, SRE.
> This document defines the SLOs for FireISP, the Prometheus alerting rules
> that enforce them, and the on-call rotation policy.

---

## Table of Contents

- [SLO definitions](#slo-definitions)
- [Error budget policy](#error-budget-policy)
- [Prometheus alerting rules](#prometheus-alerting-rules)
- [Alert routing](#alert-routing)
- [On-call rotation](#on-call-rotation)
- [SLO tracking log](#slo-tracking-log)

---

## SLO definitions

### SLO-1 — API Availability

| Attribute | Value |
|---|---|
| Target | **99.9%** successful responses per 30-day rolling window |
| Indicator | HTTP responses with status `< 500` ÷ total HTTP responses on all `/api/v1/*` endpoints |
| Measurement window | 30 days rolling |
| Error budget | 0.1% = **43.8 minutes / month** |
| Excluded | `/health`, `/health/live`, `/health/ready`, `/healthz` (probe traffic), 4xx client errors |

### SLO-2 — API Read Latency

| Attribute | Value |
|---|---|
| Target | p99 latency **≤ 500 ms** for all `GET /api/v1/*` endpoints, measured over 1-hour windows |
| Indicator | 99th-percentile HTTP response latency (Prometheus histogram: `http_request_duration_seconds`) |
| Measurement window | 1 hour |
| Error budget | p99 may exceed 500 ms for at most **0.1% of 1-hour windows** in a 30-day rolling period |

### SLO-3 — RADIUS Authentication Success Rate

| Attribute | Value |
|---|---|
| Target | **99.95%** RADIUS `Access-Accept` ÷ `Access-Request` per 24-hour window |
| Indicator | `radius_auth_accept_total` ÷ `radius_auth_request_total` (FireRelay metrics) |
| Measurement window | 24 hours rolling |
| Error budget | 0.05% = **43.2 seconds / day** of rejected authentications |
| Excluded | Intentionally rejected attempts (wrong password from blocked IP) counted as expected |

---

## Error budget policy

| Burn rate state | Action |
|---|---|
| ≤ 5% burn (within budget) | No action |
| > 50% 1-hour burn rate | PagerDuty / Opsgenie alert — on-call engineer acknowledges within 15 min |
| > 100% 1-hour burn rate (budget exhausted in < 5 h) | SEV1 page — immediate response (see `docs/runbook.md`) |
| Budget exhausted (< 0% remaining) | Feature freeze until budget is restored; post-mortem required |

---

## Prometheus alerting rules

The alerting rules are defined in `k8s/prometheus-alerts.yaml`.
They use multi-window burn-rate alerts following the Google SRE Workbook
approach: a **fast-burn** window catches sudden outages; a **slow-burn** window
catches sustained degradation.

### SLO-1 burn-rate alerts (availability)

| Alert name | Condition | Severity | Action |
|---|---|---|---|
| `FireISP_API_HighErrorRate_FastBurn` | Error rate > 14.4× budget, 1 h + 5 min windows | critical | Immediate page |
| `FireISP_API_HighErrorRate_SlowBurn` | Error rate > 6× budget, 6 h + 30 min windows | warning | Ticket + ack in 1 h |
| `FireISP_API_HighErrorRate_LongBurn` | Error rate > 3× budget, 24 h + 6 h windows | info | Review in 4 h |

### SLO-2 burn-rate alerts (latency)

| Alert name | Condition | Severity | Action |
|---|---|---|---|
| `FireISP_API_HighLatency_FastBurn` | p99 > 500 ms for > 5 min, AND short window > 14.4× budget | critical | Immediate page |
| `FireISP_API_HighLatency_SlowBurn` | p99 > 500 ms for > 30 min | warning | Ticket + ack in 1 h |

### SLO-3 RADIUS alerts

| Alert name | Condition | Severity | Action |
|---|---|---|---|
| `FireISP_RADIUS_AuthFailureSpike` | RADIUS accept rate < 99.5% over 5 min | critical | Immediate page |
| `FireISP_RADIUS_AuthFailureSustained` | RADIUS accept rate < 99.95% over 1 h | warning | Ticket |

---

## Alert routing

Configure your Alertmanager receiver in `k8s/alertmanager-config.yaml`
(create from the template below).

```yaml
# k8s/alertmanager-config.yaml — template
receivers:
  - name: pagerduty-fireisp
    pagerduty_configs:
      - routing_key: <PAGERDUTY_INTEGRATION_KEY>
        description: '{{ .GroupLabels.alertname }}: {{ .Annotations.summary }}'

  - name: email-oncall
    email_configs:
      - to: oncall@your-isp.com
        from: alerts@your-isp.com
        smarthost: smtp.your-isp.com:587

route:
  receiver: email-oncall       # default
  group_by: [alertname, job]
  group_wait:      30s
  group_interval:  5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity = critical
      receiver: pagerduty-fireisp
      group_wait:      0s
      repeat_interval: 1h
    - matchers:
        - severity = warning
      receiver: email-oncall
      repeat_interval: 4h
```

---

## On-call rotation

### Single-operator deployment

- All alerts route to the owner's email.
- Set `repeat_interval: 4h` in Alertmanager so critical alerts page again
  if not acknowledged.
- Response time target: critical → 15 min, warning → 1 h.

### Small team (2–5 operators)

1. Create a weekly on-call rotation in PagerDuty / Opsgenie.
2. Primary on-call: responsible for acknowledging and resolving alerts.
3. Secondary (escalation): paged if primary does not acknowledge within 15 min.
4. Rotation cadence: weekly (Monday 09:00 local time to Monday 09:00).

### Escalation path

```
Alert fires
  └→ Primary on-call (page / SMS)
       └→ [15 min no ack] Secondary on-call
            └→ [30 min no ack] Engineering manager / CTO
                 └→ [60 min critical unresolved] All-hands bridge
```

### Handoff checklist (end of on-call shift)

- [ ] All open incidents acknowledged and triaged.
- [ ] Any sustained warning-level alerts converted to tickets.
- [ ] On-call notes written in the incident log.
- [ ] SLO tracking log updated (see below).

---

## SLO tracking log

Update after each 30-day review cycle.

| Month | SLO-1 Availability | SLO-1 Budget used | SLO-2 Latency p99 | SLO-3 RADIUS | Notes |
|---|---|---|---|---|---|
| _(first entry goes here)_ | | | | | |
