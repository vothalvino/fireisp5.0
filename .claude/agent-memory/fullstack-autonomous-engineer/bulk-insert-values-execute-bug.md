---
name: bulk-insert-values-execute-bug
description: db.query()/execute() cannot expand INSERT ... VALUES ? with a 2-D array of rows (pool.query()-only feature) — use sqlBuild.buildBulkValues(); conn.query() (raw PoolConnection, not db.query) is unaffected
metadata:
  type: project
---

`src/config/database.js`'s `query()`/`queryReplica()` route every statement
through mysql2 `pool.execute()` (prepared statements, binary protocol).
`execute()` binds each `?` to exactly one scalar and CANNOT expand a single
`?` bound to a 2-D array of rows into `(a,b),(c,d),...` — that array-to-tuples
expansion is `SqlString.format`, used only by the **text-protocol**
`query()`/`.format()` path (verified empirically:
`require('mysql2').format('... VALUES ?', [[[1,'x'],[2,'y']]])` →
`VALUES (1, 'x'), (2, 'y')`; and by reading
`node_modules/mysql2/lib/promise/connection.js` — `.query()` delegates to the
callback `Connection.query()`, `.execute()` is a fully separate
`Commands.Execute` path in `lib/base/connection.js`). So
`db.query('INSERT INTO t (...) VALUES ?', [rows])` throws at runtime on
**every call**, silently 500ing any endpoint that hits it — found live in
`wirelessService.recordClientSessions` (POST /wireless/clients/batch — the
wireless telemetry ingest, meaning `cpe_signal`/`cpe_link_capacity`
diagnostics could never receive real data) and
`campaignService.dispatchCampaign` (bulk-queues `campaign_messages`). Fixed
on branch `fix/bulk-insert-execute-500`, commit `40b6e74`.

**Fix:** `src/utils/sqlBuild.js` (already home to `buildInsert`/`buildUpdate`,
which fixed the sibling `SET ?` single-row shorthand bug the same way) now
also exports `buildBulkValues(rows)` — builds explicit per-row placeholder
groups `(?,?,...), (?,?,...)` plus a flat, positionally-ordered parameter
array. Callers keep the table name and column list as **literal SQL text**
in their own template (never `${...}`-interpolated) and only interpolate the
returned `placeholders` string after the literal `VALUES` keyword — this is
what lets `pnpm run sql:check` keep statically resolving the INSERT's columns
(confirmed via `--verbose`: neither fixed site appears in the skip list).
Empty/absent `rows` returns `{ placeholders: '', values: [] }` — the caller
must still early-return before calling (every existing site already does,
since `VALUES ` with no tuples isn't valid SQL).

**Adjacent bug this surfaced:** `sqlBuild.js`'s `normaliseValue()`
JSON-stringifies any `typeof v === 'object'`, which incorrectly also caught
`Date` instances (`new Date()` is an object) — turning e.g. `last_seen_at`
into the literal string `"2026-01-01T00:00:00.000Z"` (quotes included) bound
to a DATETIME column. No existing `buildInsert`/`buildUpdate` caller passed a
raw JS `Date` (they all operate on request-body-sourced plain objects), so
this was latent and never observed; both new bulk sites do (`last_seen_at`,
`queued_at`). Fixed by excluding `instanceof Date` from the JSON-stringify
branch — `execute()` already binds `Date` scalars natively elsewhere in the
codebase, so passing it through unchanged matches existing behavior. Caught
by a straightforward jest run (`toEqual` diff showed the quoted string vs
`expect.any(Date)`), not by static analysis — a reminder that a "safe" reuse
of an existing helper for a new data shape still needs an actual test run.

**Do NOT "fix" `ssoService.js:saveGroupMappings`'s bulk insert** — it looks
identical (`'INSERT INTO organization_sso_group_mappings (...) VALUES ?'`,
`[values]`) but calls `conn.query(...)` where `conn = await
db.getConnection()` — the raw mysql2 `PoolConnection`'s own real `.query()`
method (text protocol), NOT the wrapped `db.query()`/`.execute()` from
`database.js`. This already works correctly and was left with only a
warning comment at the call site (no code change) so a future pass doesn't
"fix" it into `buildBulkValues()` or route it through `db.query()` — either
change would be a regression for a site that was never actually broken.
**How to apply:** before assuming any `VALUES ?` (or `SET ?`) site is broken,
check whether it's called via `db.query`/`db.queryReplica` (wrapped
`.execute()`, broken) vs `conn.query`/`conn.execute` on a connection object
obtained from `db.getConnection()` (`conn.query` = real text-protocol query,
fine; `conn.execute` = same prepared-statement limitation as `db.query`,
would need the same fix).
