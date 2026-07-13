---
name: shared-sql-helper-bound-exec-pattern
description: When extracting a shared INSERT/UPDATE helper used by both a transactional conn and the pooled db, pass a bound query FUNCTION (conn.execute.bind(conn) / db.query.bind(db)), not the conn/db OBJECT — mocked test doubles for conn and db are NOT interchangeable even though the real mysql2 objects both expose .query()/.execute()
metadata:
  type: project
---

Extracting one shared SQL-writing helper (e.g. `logSuspensionEvent`,
`closeOpenSuspensionAndGetStart` in `src/services/suspensionService.js`,
PR service-order-hardening / migration 384) used by multiple call sites that
currently issue the SAME logical statement via DIFFERENT methods —
`conn.execute(...)` inside a transaction vs `db.query(...)` for a
standalone pooled call — is a classic "de-duplicate the SQL text" refactor.
The naive shape is to accept a db/conn OBJECT and call `.execute()` (or
`.query()`) on it internally. **Don't** — in this codebase's jest suites,
`conn` and `db` are mocked as separate objects with separate, non-uniform
method sets:

- Transaction-connection mocks (from `db.getConnection()`) typically only
  stub `.execute` (e.g. `tests/suspensionService.test.js`'s
  `mockConnection = { execute: jest.fn(), ... }` — no `.query`).
- Pool mocks (`db`) stub BOTH `.query` and `.execute` as separate
  `jest.fn()`s, and existing tests assert call counts/positions on ONE
  specific method (e.g. `tests/suspensionServiceSoftSuspend.test.js` asserts
  `expect(db.query).toHaveBeenCalledTimes(3)` and inspects
  `db.query.mock.calls[2]` — calling `db.execute` instead would silently
  break that assertion, not throw).

**Fix:** give the shared helper an `exec` parameter that is a bound query
FUNCTION, not an object: `(sql, params) => Promise`. Call sites pass
`conn.execute.bind(conn)` or `db.query.bind(db)` — whichever method that
call site always used — so the helper is agnostic to which underlying
method runs, while every existing test's positional/count assertions on
`conn.execute` or `db.query` keep working unchanged. This was a deliberate
deviation from a verified fix-spec that assumed "executor is either db or
conn, both expose .query/.execute" (true for the *real* mysql2 objects, false
for the mocked test doubles) — reading the actual test files (not just the
service code) before choosing the helper's signature caught this.

**How to apply:** Any future "extract one shared SQL statement out of N
call sites that currently mix `conn.execute`/`db.query`" refactor in this
codebase should use the bound-function-parameter shape, and should grep the
call sites' EXISTING test files first to see which exact method each one's
mock asserts on before picking the signature.
