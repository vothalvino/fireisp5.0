-- Migration: 178_add_amount_to_invoice_items
-- Description: Adds the missing `amount` column to invoice_items.
--
-- Multiple code paths INSERT and SELECT invoice_items.amount but the column
-- was never defined in the schema:
--
--   INSERT paths:
--     src/services/billingService.js:129 – plan line item
--     src/services/billingService.js:147 – addon line items
--     src/models/Invoice.js:34           – Invoice.addItem()
--
--   SELECT paths:
--     src/routes/invoices.js:117         – SELECT description, amount
--     src/routes/portal.js:191           – SELECT ..., amount, ...
--     src/services/taskRunner.js:130     – SELECT description, amount
--
-- The existing `total` generated column stores quantity * unit_price.
-- `amount` carries the same semantics (line-item total value) and is
-- populated by callers on INSERT, so it is added as a regular persisted
-- column and back-filled from the existing generated `total` value.

ALTER TABLE invoice_items
  ADD COLUMN amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00
    COMMENT 'Line-item total amount (quantity × unit_price); populated on INSERT by billingService and Invoice.addItem'
    AFTER unit_price;

-- Back-fill existing rows from the generated total column
UPDATE invoice_items SET amount = total WHERE amount = 0;
