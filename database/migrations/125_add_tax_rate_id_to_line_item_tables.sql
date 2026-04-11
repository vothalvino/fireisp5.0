-- Migration: 125_add_tax_rate_id_to_line_item_tables
-- Description: Adds a per-line-item tax rate override column to the three
--              line-item tables (invoice_items, quote_items, credit_note_items).
--
--              Migration 056 added tax_rate_id to the parent document tables
--              (invoices, quotes, credit_notes) for a single document-level
--              rate.  This migration adds the same FK column at the line-item
--              level so that individual line items can carry their own rate —
--              required for mixed-rate invoices common in multi-tax-rate
--              jurisdictions (e.g. different rates for hardware vs. services).
--
--              NULL means "inherit the rate from the parent document".
--              ON DELETE SET NULL ensures that deleting a tax_rate row does
--              not cascade-delete line items.

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------------------
-- invoice_items
-- -------------------------------------------------------------------------
ALTER TABLE invoice_items
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
        COMMENT 'Per-line-item tax rate override; NULL = inherit from parent invoice'
        AFTER unit_price,
    ADD KEY idx_invoice_items_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_invoice_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- quote_items
-- -------------------------------------------------------------------------
ALTER TABLE quote_items
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
        COMMENT 'Per-line-item tax rate override; NULL = inherit from parent quote'
        AFTER unit_price,
    ADD KEY idx_quote_items_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_quote_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- credit_note_items
-- -------------------------------------------------------------------------
ALTER TABLE credit_note_items
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
        COMMENT 'Per-line-item tax rate override; NULL = inherit from parent credit note'
        AFTER unit_price,
    ADD KEY idx_credit_note_items_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_credit_note_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
