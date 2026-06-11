---
name: testing-conventions
description: Jest test structure, mock patterns, and known pre-existing failures
metadata:
  type: feedback
---

## Test mock pattern (follow notificationHooks.test.js)

- Mock `../src/config/database` as `{ query: jest.fn() }` at top
- Mock `../src/services/emailTransport`, `smsTransport`, `logger` at top
- For route tests: mock `auth`, `orgScope`, `rbac` middlewares to inject `req.user` and `req.orgId` directly
- Mock `rateLimit` middleware to avoid Redis dependency in route tests
- Use `db.query.mockResolvedValueOnce([rows])` — db.query returns `[rows, fields]` tuple

## radiusFreeradiusSync.test.js — extending the mock dispatcher

When new SQL queries are added to `syncFreeradiusTables`, the keyword dispatcher in `radiusFreeradiusSync.test.js`'s `setupMockDb` must be extended to handle the new query pattern (add a new `if (sql.includes('...'))` branch returning `[[]]` before the final fallback). Failing to do this causes "is not iterable" errors because the fallback returns `[{ affectedRows: 1 }]` instead of a `[rows]` tuple.

**How to apply:** Any time a new `db.query(...)` is added to `syncFreeradiusTables`, update the dispatcher in the existing test file (as well as `pppoeServiceProfileSync.test.js`'s `setupMockDb`).

## Pre-existing failures (do NOT investigate)

`tests/setupSecrets.test.js` — 2 tests fail because `setup.sh` has Windows CRLF line endings.
Bash cannot parse the script on Windows. This is a known issue unrelated to application logic.

**How to apply:** When running the full suite and seeing only those 2 failures, they can be ignored.
They were present before any §1.x work began.

## snmpPoller: mock queue depth must account for UPDATE calls

`snmpPoller.poll()` fires `db.query(...).catch(() => {})` after each device result:
- Success path: devices query → OIDs query → INSERT metric → **UPDATE last_polled_at** (4 calls)
- Error path: devices query → OIDs query → **UPDATE last_poll_error** (3 calls — INSERT is skipped on error)

If tests only mock 3 calls for the success path or 2 for the error path, the 4th/3rd
call returns undefined and `.catch()` throws `TypeError: Cannot read properties of undefined`.
Always add `.mockResolvedValueOnce([{ affectedRows: 1 }])` for the UPDATE calls.

## Admin bypass means no permissions mock needed for role=admin

`requirePermission` in `src/middleware/rbac.js` has:
```javascript
if (req.user.role === 'admin') { return next(); }
```
So for tests using `role: 'admin'`, skip any `permissions` / `role_permissions` mock.
If you do add a permissions mock, the mock data must use `slug` not `name`
(User.getPermissions returns `rows.map(r => r.slug)`).

## BaseModel generates backtick-quoted identifiers

BaseModel's find/findById generates: `` SELECT * FROM `users` WHERE id = ? ``
so `sql.includes('FROM users')` won't match. Use `sql.includes('WHERE id = ?')`
and add a guard like `&& !sql.includes(entity-specific-filter)` to distinguish queries.

## Frontend test runner command

`pnpm test run` is WRONG — vitest interprets "run" as a file filter, finds nothing, exits 1.
Use `pnpm test` (the script is `vitest run` without argument).
