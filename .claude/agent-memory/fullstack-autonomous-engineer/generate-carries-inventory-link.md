---
name: generate-carries-inventory-link
description: Closed the last inventory-drawdown gap — POST /invoices/generate and POST /quotes/generate now accept inventory_item_id on type:'product' lines and (for invoices) draw down stock in the same transaction
metadata:
  type: project
---

Built on branch `feat/generate-carries-inventory-link`, based on origin/main
@ 8d3a209 (includes Phases 1-3 + the sellable-items/undo-install follow-up,
migrations ≤392, PRs #410/#412/#413/#414). No migration needed — the
`invoice_items.inventory_item_id` / `quote_items.inventory_item_id` columns
already existed (migration 390). Committed locally at `ca9fb1c`, not
pushed/PR'd per brief.

This closes the LAST of the four product-picker gaps tracked across
[[inventory-phase2-product-linkage]] and
[[inventory-followups-sellable-items-undo-install]]'s "Deferred / flagged"
sections — both memories explicitly called out that `POST
/invoices/generate` / `POST /quotes/generate`'s `type:'product'` items never
carried `inventory_item_id` through, unlike `InvoiceDetail`/`QuoteDetail`'s
per-item add forms. That gap is now closed; no remaining picker path drops
the link silently.

## What shipped

- `src/routes/invoices.js` `POST /generate`: the flexible-format
  pre-processing loop's `type === 'product' || type === 'custom'` branch now
  additionally handles `inventory_item_id`, but ONLY when `type ===
  'product'` — a `custom` item's `inventory_item_id` field (if sent) is
  silently ignored, never looked up, matching the brief's "custom/free-text
  ... untouched". Same two guards as `POST /invoices/:id/items`: integer
  quantity (computed AFTER the existing `qty = Math.max(parseFloat(...) ||
  1, 0.01)` default-fill, so an omitted quantity still defaults to the
  integer `1` and passes) then org-ownership (`db.query`, outside the
  transaction — this handler's WHOLE pre-processing loop already validates
  client_id/contract_id the same way, so this stays consistent with the
  existing style rather than introducing a new convention). The route was
  ALREADY transactional (`conn.beginTransaction()` wraps invoice + items +
  billing_periods + client_balance_ledger) — no new transaction wrapping was
  needed, just one more write and one more service call inside the existing
  item-insert loop: `INSERT INTO invoice_items (..., inventory_item_id)`
  then, if linked, `inventoryDrawdownService.drawdownForSale(conn.execute.bind(conn),
  {...})` on the SAME `conn`. A drawdown failure (verified with a test: no
  stock row anywhere AND no warehouse configured, so
  `resolveOrCreateStockRow` throws) propagates up through the loop, hits the
  route's existing `catch (err) { await conn.rollback(); throw err; }`, and
  422s with nothing committed — invoice, items, AND stock are all rolled
  back together.
- `src/routes/quotes.js` `POST /generate`: identical acceptance/validation,
  but the quote_items INSERT is NOT inside a drawdown call — quotes never
  draw down (only `POST /:id/convert-to-invoice`, already carrying the
  link since migration 390, does). Verified with a test asserting zero
  `inventory_stock`/`inventory_transactions` touches on the transaction
  connection.
- Frontend: `GenerateInvoiceModal.tsx`/`GenerateQuoteModal.tsx` already used
  `buildProductPickerEntries` (the same union-picker helper as
  `InvoiceDetail`/`QuoteDetail`) for their `type:'product'` line's `<select>`
  — the ONLY missing piece was carrying `entry.inventory_item_id` through
  into the `FlexItem` posted to the backend, which a stale code comment in
  both files explicitly called out as a known gap ("does NOT carry
  inventory_item_id ... pre-existing gap, out of this follow-up's scope").
  That comment is now replaced with the real behavior. Also added: integer
  quantity enforcement mirroring `InvoiceDetail`'s `AddInvoiceItemForm`
  (`min`/`step` swap to `'1'` when the selected entry is inventory-linked,
  reset a stale fractional quantity on selection change, plus a redundant
  JS-level `Number.isInteger` check in `handleSubmit` before POSTing).
- **OpenAPI**: only touched the `jsonBody(...)` description strings for
  `/invoices/generate` and `/quotes/generate` — per [[openapi-pattern]],
  `jsonBody()` is always `{type: 'object'}` regardless of the description
  text, so this is purely cosmetic documentation and produces a
  ZERO-diff `pnpm run gen:api` (confirmed: `git diff --stat
  frontend/src/api/schema.d.ts` was empty after regenerating). Did NOT touch
  the pre-existing, already-unused `generateInvoice` schema in
  `src/middleware/schemas/invoices.js` (`{contract_id: {required:true}}`) —
  it's dead code, never wired to `validate()` on this route (confirmed by
  reading the route's imports), and extending it to describe the flexible
  `items[]` shape too would be a bigger, unrelated cleanup.

## Testing patterns that worked

- New backend suite `tests/generateInventoryLink.test.js` (9 tests) — same
  `isUserLookup`/`buildConn`/`ADMIN_USER_ROW` scaffolding as
  `tests/inventoryPhase2ProductLinkage.test.js`. `jest.spyOn(billingService,
  'nextInvoiceNumber'/'nextQuoteNumber')` sidesteps mocking the real
  `INSERT IGNORE + UPDATE + SELECT LAST_INSERT_ID()` SQL shape — same
  established pattern as that file. One PRE-EXISTING test in
  `tests/routesCoverage.test.js` (`'generates a quote from a custom item'`)
  asserted the OLD 4-column `quote_items` INSERT param array and needed
  updating to include the new trailing `inventory_item_id: null` — this is
  the correct, intended fix (the assertion was checking the exact shape
  this PR changes), not a regression to work around.
- Frontend: `tests/generateInventoryLink` equivalent additions to
  `GenerateInvoiceModal.test.tsx`/`GenerateQuoteModal.test.tsx` hit the
  SAME native-HTML5-validation gotcha `InvoiceDetail.test.tsx` already
  documents (see its comment above `'blocks submit with a fractional
  quantity...'`): a real `user.click()` on the submit button triggers
  jsdom's native `stepMismatch` constraint validation BEFORE React's
  `onSubmit` handler ever runs (the form has no `noValidate`), so a
  fractional value on a `step="1"` input silently blocks submission without
  ever reaching the JS-level `Number.isInteger` check or its error message.
  Fix: `fireEvent.change(qtyInput, {target: {value: '1.5'}})` +
  `fireEvent.submit(qtyInput.closest('form')!)` instead of `user.click(...)`
  — `fireEvent.submit` bypasses native constraint validation and targets
  the JS check directly, exactly like `InvoiceDetail.test.tsx` already does.
  This cost one failed test run to discover before finding the existing
  precedent in `InvoiceDetail.test.tsx` — search for that pattern FIRST next
  time a "reject fractional quantity" test needs writing against one of
  these number-input-with-step forms.
- `screen.getByDisplayValue('1')` reliably finds the quantity input right
  after selecting a product (default quantity '1', autofilled unit price is
  a DIFFERENT string like '150.00') — cheaper than adding `id`/`htmlFor`
  wiring to these modals just for testability (which neither modal has for
  ANY field; out of this brief's scope to retrofit).
