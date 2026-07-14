---
name: quotes-like-invoices-approval
description: QuoteDetail.tsx build (PR feat/quotes-like-invoices-approval) — approve/reject state machine, convert-to-invoice gate, item-recompute pattern, and the quote_number auto-gen gap found but not fixed
metadata:
  type: project
---

Built `frontend/src/pages/QuoteDetail.tsx` (new) mirroring `InvoiceDetail.tsx`'s structure, plus `POST /quotes/:id/approve` and `POST /quotes/:id/reject` (both `quotes.update`, no new permission, no migration — user-confirmed decision).

**Key finding: InvoiceDetail has no "add item" UI at all.** Invoices are built in one shot via `GenerateInvoiceModal` (contract/product/custom line items assembled client-side, submitted together to `POST /invoices/generate`); `InvoiceDetail.tsx` only ever *displays* `GET /invoices/{id}/items`, it never POSTs one. So "mirror InvoiceDetail's item recompute" had no literal precedent to copy — the recompute-from-items behavior on QuoteDetail (POST item → refetch items → `computeTotals` → `PUT` quote) was newly designed, following the exact same math `POST /invoices/generate`'s flexible-item path uses in `src/routes/invoices.js` (`subtotal * taxPct`, tax_rate as a 0-1 fraction, `Math.round(x*100)/100` throughout — see [[mysql2-decimal-string-gotcha]] class of bug, avoided here since tax_rate is read from the quote row and Number()-cast before math).

**convert-to-invoice gate:** added `if (quote.status !== 'accepted') return 409 {code:'QUOTE_NOT_ACCEPTED'}` in `src/routes/quotes.js`, right after the existing 404 check, before the transaction. The route's trailing `UPDATE quotes SET status='accepted'` (a leftover from when convert *was* the accept step) is now a harmless no-op and was deliberately left in place rather than removed, to avoid touching the transaction shape existing tests assert against.

**Approve/reject are fully lenient by design** — `Quote.update(id, {status}, orgId)` via BaseModel, no status-transition guard at all. The brief's own transition rules ("draft/sent/expired allowed, plus re-deciding accepted↔rejected") turn out to cover every ENUM value, so there was nothing to actually gate. Convert-to-invoice detectability of "already converted" was investigated and rejected: `quotes` has no `invoice_id` back-reference column, so it's not detectable without a migration (out of scope) — noted in the route comment.

**Adjacent bug found, not fixed (flagged per CLAUDE.md):** `quotes.quote_number` is `NOT NULL` with **no** server-side default or atomic sequence (unlike `invoices.invoice_number` via `billingService.nextInvoiceNumber`, migration 381). The old `QuoteList.tsx` create-modal placeholder said "auto-generated if blank" — that was a lie; leaving it blank hits the NOT-NULL constraint. Fixed by making `quote_number` a required field in the new `CreateQuoteModal` (no migration = no way to fix the underlying gap this PR). A proper fix needs a migration adding `organization_quote_sequences` mirroring migration 381 — flagged for a follow-up, not attempted here.

**QuoteList.tsx restructuring:** removed the old combined create+edit `QuoteModal` (which let users hand-type subtotal/tax_amount/total — the exact pattern this PR replaces) and the row-level Convert-to-Invoice action (now gated by status=accepted only, lives on QuoteDetail instead, avoiding two separate gating implementations that could drift). Row-level Edit was also removed — editing now lives on QuoteDetail via a new `EditQuoteModal` (metadata + manual totals override, mirroring `EditInvoiceModal`), with status deliberately **excluded** from that modal so Approve/Reject are the only door for status changes.

**Test gotcha:** `getByLabelText` needs the `<label>` to *wrap* the input (implicit association) or use `htmlFor`/`id` — several existing modals in this codebase put `<label>` and `<input>` as siblings with only a shared `style`, which breaks `getByLabelText`. Added explicit `htmlFor`/`id` on the new `AddItemForm` fields in QuoteDetail rather than copying the sibling pattern.

Branch `feat/quotes-like-invoices-approval`, next migration still 389 (unchanged — no migration in this PR).
