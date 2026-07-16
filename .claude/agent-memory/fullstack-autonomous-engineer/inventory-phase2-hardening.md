---
name: inventory-phase2-hardening
description: Inventory Phase 2 (migration 390) adversarial-review hardening — quote-conversion idempotency, integer-quantity gate, void-invoice guard; amended migration 390 in place rather than adding 391
metadata:
  type: project
---

Built on branch `feat/inventory-phase2-products` (worktree `.claude/worktrees/agent-a55680fee39096cd9`, commit b693989 was the original Phase 2 feature; the hardening fixes below landed as follow-up commits on the SAME branch/migration since it had not yet merged). Phase 2 has since merged as PR #412 — migration 390 is now append-only like any shipped migration.

## What was fixed (4 defects from adversarial review of PR b693989)

1. **Quote→invoice conversion was not idempotent.** `POST /quotes/:id/convert-to-invoice` gated only on `status === 'accepted'`, but its own terminal write left status at `'accepted'` — a retry/double-click sailed through and created a duplicate invoice + duplicate `drawdownForSale` (silent double stock decrement). Fixed by extending migration 390 (not a new migration — it hadn't merged) with `quotes.converted_invoice_id BIGINT UNSIGNED NULL` (FK → `invoices`, `ON DELETE SET NULL`), stamped inside the SAME transaction as the invoice INSERT. A second attempt now 409s `CONVERSION_EXISTS` before any transaction opens.
2. **Fractional quantity on an inventory-linked line silently rounded.** `invoice_items`/`quote_items.quantity` is `DECIMAL(10,2)` but stock/ledger columns are integer. `POST /invoices/:id/items` and `POST /quotes/:id/items` now `422` when `inventory_item_id` is set and `!Number.isInteger(quantity)` — checked in the route handler, since this codebase's `validate()` middleware (`src/middleware/validate.js`) has NO cross-field/conditional rule support, only flat per-field type/min/max/enum. `inventoryDrawdownService.drawdownForSale` also `Math.round()`s defensively as a second line of defense.
3. **`POST /invoices/:id/items` never checked invoice status.** A line added to a void invoice still decremented stock. Fixed by adding an org-scoped `status` lookup to BOTH branches (the plain/non-inventory branch previously did NO invoice lookup at all — it just blindly wrote via `Invoice.addItem`), rejecting with `422 INVOICE_VOID` (same `AppError` shape as the existing `beforeUpdate` guard on PUT/PATCH).
4. **Documented only:** dropping the migration-127 negative-stock trigger also lets pre-existing manual outbound transactions (`assign_to_job`/`transfer_out`) go negative — accepted org-wide policy, noted in the migration 390 header.

## Reusable patterns

- **Amending an unmerged migration is allowed and preferred over a new migration number** when the fix is to the same feature and the original hasn't shipped — avoids migration-number churn for a single logical change. Once merged, this would NOT be allowed (append-only after merge).
- **jsdom blocks native `<button type="submit">` clicks on HTML5 step/min mismatch** — a `fireEvent.click` on a submit button when an `<input type="number" step="1">` holds `"1.5"` never fires the React `onSubmit` handler at all (jsdom enforces constraint validation on the implicit-submission path). To test custom JS-level validation logic that duplicates/backstops native constraints, use `fireEvent.submit(input.closest('form'))` instead — it dispatches the `submit` event directly, bypassing jsdom's native validity gate. Confirmed on both `QuoteDetail.test.tsx` and `InvoiceDetail.test.tsx`.
- **openapi.js responses is a plain description string** (`r200(desc)`/`r201(desc)` always emit `schema: {type:'object'}`) — adding a new response field to an entity (e.g. `quotes.converted_invoice_id`) needs NO spec change; only new status codes (409/422) need explicit `responses: {...r201(...), 404: {...}, 409: {...}}` entries, mirroring the `contracts.js` suspend/unsuspend inline-response style.

## Verification (this hardening pass)

- `node src/scripts/schema-parity-check.js`: 0 failures
- `pnpm run sql:check`: passed, 328 tables, no drift
- `pnpm run openapi && pnpm run spec:check`: 893 paths, 0 drift
- Backend targeted: `tests/inventoryPhase2ProductLinkage.test.js` (21 tests), `tests/routesCoverage.test.js`, `tests/coreRoutes.test.js`, `tests/routeValidation.test.js` — all green after updating 2 pre-existing tests whose mocks needed the new invoice-status lookup added to their db.query call chains
- Full backend suite (`npx jest --forceExit`): 300/301 suites (1 pre-existing unrelated skip), 6114/6138 tests, 0 failed
- Frontend: `tsc --noEmit` clean, `i18n:check` 3416/3416 (en/es/pt-BR), full `vitest run` 777/777 passed
