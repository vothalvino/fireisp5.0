---
name: balance-computed-currency-org
description: client_balance_ledger replaced as the balance SOURCE by computeClientBalance (invoices+payments); hardcoded 'USD' currency-default sweep across invoice/quote/payment/chargeback/credit-note/reseller routes
metadata:
  type: project
---

Branch `fix/balance-computed-currency-org` (commit 7256846, based on
4f6ca56/main — PR #416's paymentAllocationService). No migration.

**Problem 1 — the ledger drifts from reality.** `client_balance_ledger` is
written by SOME money paths but not all consistently (verified live: client
35 had one credit-note ledger entry making the page read "in credit" next to
a genuinely unpaid open invoice with zero ledger entries of its own). Added
`src/services/clientBalanceService.js#computeClientBalance(orgId, clientId)`
as the ONE computed source: `SUM(balance_due of payable invoices) -
SUM(unallocated remainder of completed payments)`, reusing
`paymentAllocationService.getInvoicesWithBalance` (do not fork a second
formula — see [[payment-fifo-waterfall]]). Currency: org currency unless
every contributing (nonzero) row agrees on one — never fakes conversion.

**Every consumer switched**, found via `grep -rln client_balance_ledger
src/`: GraphQL `Client.balance` (now `.toFixed(2)`, was a raw ledger SUM
string) + new `Client.balanceCurrency` field, `supportBillingModule.js`'s
`_balanceQuery` (also fixed a **real cross-org hole**: the old fallback
query had `WHERE client_id = ?` with **no organization_id filter at all**),
`supportContextService.js`'s `enrichContext` billing block, and the client
portal dashboard `GET /portal/dashboard` (was previously a raw
`SUM(total)` of unpaid invoices — ignored allocations entirely, so a
partially-paid invoice overstated the client's balance; now uses the same
computed figure). The ledger itself (GET /clients/:id/balance-ledger,
GraphQL `ledger` field, the statement PDF) is explicitly LEFT UNCHANGED —
it's the audit trail, not the balance source; each of those files/resolvers
now has a comment saying so.

**GraphQL sibling-field race**: `balance` and `balanceCurrency` are two
separate field resolvers off the same parent in one query. graphql-js kicks
off sibling resolvers concurrently (not sequentially), so "resolver A
computes and caches on the parent object, resolver B reads the cache" has a
race — B can run before A's cache write lands. Fixed by memoizing the
**in-flight PROMISE** (not the resolved value) in a `Map` keyed by client id
on the per-request `ctx` object (`ctx._clientBalanceCache`), built fresh
per-request in `src/graphql/index.js`'s `context: ({req}) => ({...})`. Test
proof: assert `mockQuery` call count when both fields are queried together
(3 calls: findById + invoices + payments, never doubled).

**Problem 2 — hardcoded `'USD'` currency defaults everywhere.** Swept every
`'USD'` literal in `src/` (`grep -rn "'USD'" src/`). DB columns
(`plans.currency`, `invoices.currency`, `payments.currency`,
`credit_notes.currency`, `chargebacks.currency`) are almost all `NOT NULL
DEFAULT 'USD'` — meaning `row.currency || 'USD'` fallbacks reading an
EXISTING row are dead code (the column always has a value); the REAL bugs
are at row-CREATION time when currency is omitted and the DB's own
column-default 'USD' silently wins regardless of the org's real currency.
Fixed the creation-time bugs: `invoices.js`/`quotes.js` flexible-format
`/generate` (currency stayed hardcoded 'USD' when a request had NO
`type:'contract'` item — pure product/custom invoices never touched the
plan-currency branch at all), `billingService.generateInvoice` (plan
currency fallback) + `recordPaymentCredit`, `payments.js` POST /,
`chargebacks.js` POST / (found unreachable in practice — `currency` is
`required:true` in `createChargebackSchema`, so omitting it 422s before the
handler runs; fixed anyway for defense-in-depth, test removed since the
scenario is impossible to construct), `creditNotes.js` POST / (defaults to
the **linked invoice's own currency** when `invoice_id` given, else org —
a credit note should match its invoice's currency), `resellers.js`
plan-prices POST + billing-entity PUT. Rule everywhere: `req.body.currency
|| await Organization.getCurrency(orgId)`, fetched once per request, never
in a loop. Left alone as genuinely-dead-code (documented, not touched):
`pdfService.js`'s `fmt()` default param, `emailTemplates.js`'s template
fallbacks, `resellerService.js`/`paymentGatewayService.js`'s read-an-
existing-row fallbacks — all callers already pass a real DB-sourced
currency.

**Frontend**: `frontend/src/auth/useOrgCurrency.ts` already existed
(reads `user.organization_currency` from `GET /auth/me`, established
pattern used by PlanList/InventoryList/OperationsConsole) — used it to prime
`RecordPaymentModal.tsx`'s currency field instead of a hardcoded `'MXN'`
initial `useState`; the existing "prime from open-invoice currency once
loaded" effect still overrides it with the more-specific per-client value.
Org currency IS already editable in the UI: `OrganizationList.tsx`'s edit
modal has a `Currency` field wired to `PUT /organizations/:id` — no new
settings UI needed (checked per brief's "skip if none exists" instruction;
one already did).

**Test-mock gotcha discovered 3x**: adding a new `db.query`/`Organization.getCurrency`
call inside a route broke pre-existing tests that use POSITIONAL
`.mockResolvedValueOnce()` chains (not SQL-matching `mockImplementation`)
without sending `currency` in the request body — `tests/routesCoverage.test.js`,
`tests/coreRoutes.test.js`. Fix pattern: insert a new `.mockResolvedValueOnce([[{
currency: 'MXN' }]])` at the correct position in the chain, or switch the
test to explicitly send `currency` in the request if the test isn't about
currency at all. Tests using SQL-matching `mockImplementation((sql) => ...)`
with a catch-all `Promise.resolve([[]])` needed NO changes (the extra query
silently falls through to `Organization.getCurrency`'s own `|| 'MXN'`
fallback) — prefer that pattern over positional chains when a test's
scope might grow.
