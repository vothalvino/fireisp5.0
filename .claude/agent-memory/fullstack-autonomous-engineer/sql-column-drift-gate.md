---
name: sql-column-drift-gate
description: src/scripts/sql-column-check.js statically validates every INSERT/UPDATE column + ENUM literal against schema.sql; it is a CI gate and it found ~16 always-500 statements
metadata:
  type: project
---

`src/scripts/sql-column-check.js` (npm: `pnpm run sql:check`, CI step in `lint-and-test`,
plus `tests/sqlColumnCheck.test.js` so it runs in `pnpm test`) parses every
`INSERT INTO t (cols…)` / `UPDATE t SET col = …` in `src/**/*.js` and asserts each
column exists on that table in `database/schema.sql`, and that every statically
visible single-quoted literal written to an ENUM column is one of its values.

**Why:** the Jest suite mocks the DB entirely, so a misnamed column passes every test
and 500s forever in production. The `suspension_logs` INSERTs shipped that way from
day one (four bogus columns + action values not in the ENUM) — every suspend /
reconnect / dunning / payment-auto-reconnect path was broken since the original
implementation. Running the checker for the first time turned up ~16 more statements
in the same state (CFDI payment complements, DDoS rules, numbering blocks,
scheduled-task bookkeeping, secure-deletion log, payment_transactions, …), all fixed
in the same PR.

**How to apply:**
- Never widen `KNOWN_SCHEMA_GAPS` in that script — it is a ratchet, and today it holds
  exactly one entry: `users.reset_token_hash / reset_token_expires / email_verified_at /
  email_verify_token_hash` do not exist, so `POST /auth/forgot-password`,
  `/auth/reset-password` and `/auth/verify-email` 500 on every call. That needs a
  migration (follow-up PR) — closing it means deleting the entry.
- Dynamic SQL (template-interpolated table or column lists) is **skipped and counted**,
  never guessed — ~111 statements. Don't "fix" a skip by guessing.
- Two parser traps, both pinned by tests: SQL `-- comments` inside `CREATE TABLE`
  bodies (they swallow the column beneath them if not stripped), and regex literals —
  `return /[,"\n]/…` and `${…replace(/"/g, '""')}` both derail a naive scanner.
- Its limits: it cannot check values bound as `?` params, NOT-NULL columns omitted
  from an INSERT, or `validate()` enums vs column ENUMs. The DDoS route was broken in
  all three ways at once.
