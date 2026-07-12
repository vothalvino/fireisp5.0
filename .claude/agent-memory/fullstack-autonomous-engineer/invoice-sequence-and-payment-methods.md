---
name: invoice-sequence-and-payment-methods
description: Migration 381 replaced COUNT(*)+1 invoice numbering with an atomic per-org sequence table; payments.payment_method validation enum aligned to the full DB ENUM (adds OXXO/SPEI/CoDi etc.) — PR #389
metadata:
  type: project
---

Migration 381 (`database/migrations/381_organization_invoice_sequences.sql`)
adds `organization_invoice_sequences` (`organization_id` PRIMARY KEY —
sentinel `0` for the NULL/single-tenant bucket; `next_number`), seeded from
existing `invoices` data per org: `1 + GREATEST(MAX(parsed 'INV-%' numeric
suffix), COUNT(*))`, across ALL invoices including soft-deleted (a soft-
deleted invoice's number still counts — it was already issued).

**`billingService.nextInvoiceNumber(conn, orgId)`** (new, exported) replaces
the `SELECT COUNT(*) FROM invoices WHERE organization_id = ?` + 1 pattern at
all four sites that generated `INV-######` numbers:
`billingService.generateInvoice`, `billingService.createOneOffInvoice`,
`routes/invoices.js` `POST /generate`'s flexible-format path, and
`routes/quotes.js` `POST /:id/convert-to-invoice`. See
[[mysql-atomic-sequence-idiom]] for why it's `INSERT IGNORE` + a bare
`UPDATE ... LAST_INSERT_ID(next_number)` — NOT a single `INSERT ... ON
DUPLICATE KEY UPDATE` — and why that distinction matters correctness-wise,
not just stylistically.

**Investigated and confirmed NOT the live bug vector**: migration 361
already made `uq_invoices_org_number` soft-delete-aware
(`(organization_id, invoice_number, active_flag)`, generated `active_flag`
column NULL when `deleted_at` is set — MySQL doesn't de-dupe NULLs), so a
soft-deleted invoice's number can't collide with a reissued one at the DB
constraint level, and the `COUNT(*)` query never filtered `deleted_at`
anyway (so the count didn't even drop after a soft delete). The REAL,
confirmed-reproducible bug was the **concurrency race**: `COUNT(*)` is a
non-locking read, so two concurrent invoice-generation calls for the same
org (overlapping scheduled `runAutoInvoice` + manual generate, or two
overlapping `bulk-generate` requests) could read the same count and both
attempt to `INSERT` the same `invoice_number`, hitting the unique-key 500.
`lifecycleService.generateOrderNumber` (`SO-######` service-order numbers)
shares the identical `COUNT(*)`-based pattern and has the same theoretical
race, but was explicitly out of scope for this fix — flagged, not touched.

**`payments.payment_method` validation** (`src/middleware/schemas/payments.js`):
the DB ENUM (migrations 012/074/180) supports 14 values —
`cash, check, card, transfer, online, credit_card, debit_card,
bank_transfer, oxxo_pay, spei, codi, convenience_store, digital_wallet,
other` — but `createPayment`/`updatePayment`'s validation enum only listed
6, so `card`/`transfer`/`online` (the frontend's own simplified generic
values!) and all five Mexico-specific instruments 422'd on submit despite
the DB accepting them. Fixed with one shared `PAYMENT_METHODS` const used
by both schemas. Frontend had THREE separate hardcoded method lists
(`components/RecordPaymentModal.tsx`, `pages/InvoiceDetail.tsx`'s inline
modal, `pages/payments/PaymentActions.tsx`'s `EditPaymentModal` — the last
one exported and reused by `PaymentList.tsx`'s own modal) all updated to
match, with option labels moved to i18next (`paymentMethods.*` namespace,
all three locales — es uses Mexico-appropriate brand names: OXXO Pay, SPEI,
CoDi, kept untranslated per Mexican fintech convention). None of these
three modal components were i18n'd for any OTHER string before this change
(plain hardcoded English) — only the payment-method option labels were
brought under i18next, intentionally scoped; a full i18n retrofit of these
modals is a separate, larger effort, not attempted here. Display-only
payment-method text elsewhere (payments table cell, `PaymentDetail.tsx`)
was left as pre-existing `.replace(/_/g, ' ')` formatting — out of scope
(forms/selects only, not every read-only display spot).
