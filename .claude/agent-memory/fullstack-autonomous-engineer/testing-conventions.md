---
name: testing-conventions
description: Jest test structure, mock patterns, and known pre-existing failures
metadata:
  type: feedback
---

## Integration tests that require app.js — must mock BOTH requirePermission AND requireRole

`firerelay.js` calls `requireRole('admin', 'owner')` at route-registration time (not request time). If your test mocks `rbac` to only export `requirePermission`, the app.js load will throw `TypeError: requireRole is not a function`. Always include both in the mock:

```javascript
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
```

## Validation schemas use plain objects, not Joi

The `validate()` middleware uses `{ fieldName: { type, required, min, max, enum } }` objects. Joi is NOT installed. Never write `require('joi')` in schema files.

## ValidationError returns 422, not 400

`new ValidationError(...)` in `src/utils/errors.js` uses status 422. Validation failure integration tests must `expect(res.status).toBe(422)`.

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

**Frontend tests have ZERO pre-existing failures.** During §13 ~20 frontend test failures (i18n.test.ts, Login.test.tsx, Layout.test.tsx, aiSettings.test.tsx) were misdiagnosed as "pre-existing" — they were actually caused by cp1252 mojibake that the §13 work itself introduced into the locale files (repaired before merge; main is clean and CI green). If frontend tests fail on a branch, the branch caused it: first check for mojibake (`grep -l "â€\|Ã©\|ðŸ" $(git diff --name-only origin/main..HEAD)`) and verify the same test passes on origin/main before calling anything pre-existing.

## `database/schema.sql` already contains pre-existing mojibake — editing near it can silently double-encode NEW text too

`database/schema.sql` has had corrupted em-dash/arrow/section-sign bytes (`â€"`, `â†'`, `Â§` — double-encoded UTF-8) in table-comment prose since long before any of this work (confirmed via `git show <old-commit>:database/schema.sql`, not something any recent PR introduced). During the service-order simplified-flow migration (380), an `Edit` call whose `old_string` matched existing corrupted comment text ended up producing corruption in the *newly written* comment sentences too (same double-encoding pattern), even though the new text was intended to use plain "—"/"→" characters — `git diff`'s terminal rendering looked identical to the pre-existing corruption, so it was easy to mistake as "already there."

**How to apply:** After editing any comment/prose near already-mojibake'd text in `schema.sql` (or any file with known historical encoding damage), verify with a byte-level check, not just the Read/diff rendering — the mojibake round-trips through UTF-8 as *valid* text, so it displays as itself, not as an error:
```python
python3 -c "
import subprocess
diff = subprocess.check_output(['git','diff','--','database/schema.sql']).decode()
added = [l for l in diff.splitlines() if l.startswith('+')]
bad = [l for l in added if any(m in l for m in ['â€','Â§','â†’','Ã©'])]
print(bad or 'clean')
"
```
If it flags any `+` lines, rewrite that specific comment using plain ASCII (`->` instead of `→`, `-` instead of `—`, spell out "section 1.2" instead of `§1.2`) rather than retyping the Unicode glyph — it avoids the whole class of encoding round-trip risk in this file.

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

## jest.resetAllMocks() vs clearAllMocks() in beforeEach

When tests use BOTH `mockImplementation()` and `mockResolvedValueOnce()` in the same describe block, use `jest.resetAllMocks()` in `beforeEach` (not `clearAllMocks()`). `clearAllMocks()` only clears call history but does NOT clear the `mockResolvedValueOnce` queue — unconsumed `Once` calls from previous tests bleed into the next test and override the freshly-installed `mockImplementation`.

**Why:** Discovered in §20 tests where `mockResolvedValueOnce([[]])` from test A was being consumed by test B's first db.query call, causing getConnection to return null unexpectedly.

**How to apply:** In test files that mix `mockImplementation` (in beforeEach) with `mockResolvedValueOnce` (in individual tests), always use `jest.resetAllMocks()` at the top of `beforeEach`, then reinstall the `mockImplementation` after.

## Modal header ✕ button + a footer text button can share an accessible name

A common modal pattern in this codebase is a header close button with
`aria-label="Close"` (rendered as "✕") plus, conditionally, a footer button
whose *text content* is also "Close" (e.g. a read-only view that swaps
"Cancel"/"Save" for a single "Close"). `aria-label` wins for accessible-name
computation, so both elements compute to the same accessible name and
`getByRole('button', { name: 'Close' })` throws "multiple elements found."

**How to apply:** Use `getAllByRole('button', { name: 'Close' })` and index
into the result (footer action is typically the last one in DOM order) when
a test needs to click the footer close/cancel button specifically. Seen in
`RoleList.test.tsx`'s admin-kind read-only permission matrix test.

## react-leaflet components require mocking in vitest

`react-leaflet`'s `MapContainer` and other components try to access DOM canvas/SVG which jsdom doesn't support. Any test for a page that imports from `react-leaflet` must mock the module:

```typescript
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Polyline: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="polyline">{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));

// Also mock the CSS import:
vi.mock('leaflet/dist/leaflet.css', () => ({}));
```

**How to apply:** Any frontend test file that renders a component with `MapContainer` from react-leaflet must include both mocks above, or the test will fail with jsdom canvas errors.

## Some test files `jest.mock()` a whole service module — check before assuming "real implementation" test patterns transfer

`tests/routesCoverage.test.js` has `jest.mock('../src/services/billingService')` at the top (Jest auto-mock: every exported function becomes a `jest.fn()` returning `undefined` unless configured). `tests/billingService.test.js`, `tests/e2eBillingWorkflow.test.js`, `tests/e2ePaymentFlow.test.js`, `tests/integrationWorkflow.test.js`, and `tests/routeIntegration.test.js` do NOT mock it — they exercise the real implementation via a mocked `conn`/`db`.

**How to apply:** Before editing `conn.execute`/`conn.query` mock sequences in a route-level test file to account for a change inside a service function, `grep -n "jest.mock.*services/<name>"` that specific test file first. If the service is whole-module-mocked, the route handler's call into it never touches `conn` at all — mock the service function's return value directly (`serviceName.fnName.mockResolvedValue(...)`) instead of trying to replicate its internal DB call sequence. Mixing the two approaches produces a queued-mock off-by-N that manifests as a confusing downstream error (e.g. "X is not iterable") several calls later, not at the call site that's actually wrong. Seen fixing `nextInvoiceNumber()` (PR #389): `routesCoverage.test.js`'s quotes-convert-to-invoice tests needed `billingService.nextInvoiceNumber.mockResolvedValue(...)`, while every other affected test file needed real `conn.execute`/`conn.query` mock entries for the function's actual SQL statements.

## CI's README-sync check has TWO independent assertions — both must be updated

`.github/workflows/ci.yml`'s "Validate README.md is in sync with migrations and schema" step checks (a) the migration range (`grep 'Individual numbered migration files' README.md`, e.g. `001–381`) AND, separately, (b) `grep -oE 'all [0-9]+ tables' README.md` against `grep -c "CREATE TABLE" database/schema.sql`. The second one lives in the repo-tree diagram near the top of README.md (`schema.sql # Combined schema (all N tables + column additions)`), NOT in the numbered "Database Tables" markdown list further down — that list is a curated/incomplete subset and does not need to reach the same number. Adding a new table to `schema.sql` bumps the CREATE TABLE count and requires updating the "all N tables" line specifically, separate from bumping the migration range.

**How to apply:** After any migration that adds a table, run this locally before pushing (matches CI exactly):
```bash
grep -c "CREATE TABLE" database/schema.sql
grep -oE 'all [0-9]+ tables' README.md
```
Both numbers must match, and both differ from the "Database Tables" list's last row number.
