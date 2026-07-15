---
name: payment-fifo-waterfall
description: POST /payments/:id/allocate-auto (FIFO oldest→newest, multi-invoice) + GET /clients/:id/open-invoices; fixed a real cross-org hole in the old single-invoice allocate route; no migration needed
metadata:
  type: project
---

Branch `feat/payment-fifo-allocation` (commit a5197c6, based on d5ec927/main,
not pushed): RecordPaymentModal's checklist UX (pick a client → open invoices
load with balance_due → all checked by default, amount auto-fills to their
sum → submit applies the payment oldest→newest atomically).

**Cross-org security hole found + fixed.** `POST /payments/:id/allocate` had
**no `organization_id` filter on either the payment or the invoice lookup** —
any authenticated user in org A could allocate org B's payment to org B's
invoice by guessing/enumerating ids, marking it paid and reconnecting org B's
suspended contract. `orgScope` middleware only sets `req.orgId`; it does not
auto-filter queries — every raw-SQL route must apply it itself (routes that
already did, e.g. reallocate/reassign/unapply, were fine). Fixed by adding
the same org-verify `SELECT ... WHERE id = ? AND organization_id = ?` the new
`allocate-auto` route also uses. Deliberately did NOT also add a same-client
check to the OLD route (same-org-wrong-client misallocation is a separate,
narrower pre-existing gap) — flagged to the user rather than silently
expanding the fix's blast radius across ~12 existing test call-chains that
already needed updating for the org-filter alone.

**Shared logic, not duplicated**, in `src/services/paymentAllocationService.js`:
`finalizeIfFullyPaid(exec, invoice)` (mark paid+paid_at once fully covered —
exact SQL/param shape preserved 1:1 from the old route so existing tests
didn't need touching) and `reconnectIfSuspended(invoice, userId)` (always
called AFTER commit — `suspensionService.reconnectContract` opens its own
connection/transaction and cannot join an outer one) back BOTH the old and
new allocate routes. `getInvoicesWithBalance(exec, orgId, clientId,
invoiceIds, forUpdate)` (client's payable invoices — `issued`/`sent`/`overdue`
— with a computed `balance_due` subquery column, oldest-issue-date-first)
backs both `GET /clients/:id/open-invoices` (checklist display) and
`allocate-auto`'s invoice-selection query, so the order the UI shows always
matches the order money is actually applied in.

**No migration** — `payment_allocations`/`invoices` already supported
everything. `invoices.status` ENUM has no `partial`/`partially_paid` value; a
partial allocation intentionally leaves status untouched (mirrors
`billingService.refreshInvoicePaidStatus`'s existing paid↔issued-only logic).

**Frontend consolidation**: `RecordPaymentModal` existed as **3 independently
diverged copies** of the same component name (`components/RecordPaymentModal.tsx`
used by ClientDetail; separate page-local copies inside `InvoiceDetail.tsx`
and `PaymentList.tsx`) — merged into one shared component using the
established "optional `lockedClientId`, self-fetch clients when absent"
pattern from `GenerateInvoiceModal.tsx` (query `enabled: !lockedClientId`,
no `clients` prop needed from callers). Added `lockedInvoiceId` for
InvoiceDetail's "pre-check just this invoice, others still listed
unchecked" entry point. See [[env-node-modules-worktree]] for the
node_modules symlink workflow used to run `gen:api`/`tsc`/vitest in this
worktree.

**e2e**: `e2e/tests/smoke.spec.ts`'s payment step was updated for the new
"success summary panel, then a Done button" flow (submit no longer closes
the modal immediately — the same `role=dialog name=/record payment/i`
locator stays visible showing results until Done is clicked). NOT executed
locally — this sandbox has no `docker` binary and the e2e suite needs
`docker-compose.e2e.yml` (CLAUDE.md already documents this requirement); the
DOM-compatibility trace (client `<select>` still first, amount still the
only `type="number"` input) was done by reading the rendered JSX, not by
running Playwright. Flag this to the user as a residual manual/CI check.
