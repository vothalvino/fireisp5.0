---
name: mysql2-decimal-string-gotcha
description: mysql2 returns DECIMAL columns as JS strings, not numbers — comparisons/arithmetic need explicit Number() or they silently do lexicographic string comparison
metadata:
  type: feedback
---

`src/config/database.js`'s pool config has no `decimalNumbers: true`, so
every `DECIMAL(m,n)` column comes back from `db.query`/`pool.execute` as a
JS **string** (e.g. `"9.50"`), never a number — this is mysql2's
precision-safe default, and this codebase has not opted out of it.

**Why this matters:** comparing or doing arithmetic on two such values
without an explicit `Number()` cast risks JS's abstract
relational comparison falling back to **lexicographic string comparison**
when both operands happen to be strings: `"9.50" < "20.00"` is `false`
(since `'9' > '2'` character-wise) even though `9.5 < 20` numerically —
a silent wrong answer, not a crash, so it's easy to ship undetected.

**How to apply**: any time you read a DECIMAL column and then compare it
(`<`, `>`, `<=`, `>=`) or do math on it, cast explicitly and handle
null/undefined first: `const x = raw === null || raw === undefined ? null
: Number(raw)`. This codebase's existing precedent is
`billingService.js`/`invoices.js`'s `parseFloat(contract.price_override ||
plan.price)` for the same reason. Confirmed via migration 388's
`cpe_link_capacity` check (`wireless_client_sessions.tx_rate_mbps`/
`rx_rate_mbps`, `ap_sector_configs.link_capacity_min_mbps`,
`contracts.wireless_link_capacity_min_mbps` are all DECIMAL) — see
[[migration-388-diagnostic-thresholds]]. SMALLINT/INT/TINYINT columns are
NOT affected — mysql2 returns those as real JS numbers by default; only
DECIMAL/BIGINT need this treatment.
