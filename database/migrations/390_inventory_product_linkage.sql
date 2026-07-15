-- =============================================================================
-- Migration 390 — Inventory Phase 2: product linkage + sale drawdown
-- =============================================================================
-- Links inventory_items into the invoice/quote "product" catalog so a
-- physical stock item can be sold on an invoice/quote and (for invoices)
-- automatically decrement stock with a ledger row.
--
--   * plan_addons.inventory_item_id    — optional link: this catalog product
--     is backed by a physical inventory_items row.
--   * invoice_items.inventory_item_id  — which inventory item an invoice line
--     sold, if any. Drives automatic stock drawdown in POST /invoices/:id/items
--     and POST /quotes/:id/convert-to-invoice.
--   * quote_items.inventory_item_id    — same link on a quote line, carried
--     through unchanged to invoice_items on conversion (quotes themselves
--     never draw down stock — only converting to an invoice does).
--
-- All three are nullable FKs (ON DELETE SET NULL — deleting an inventory item
-- must never cascade-delete billing history) and guarded via INFORMATION_SCHEMA
-- so this migration is idempotent (see migration 371/374 pattern).
--
-- Also drops the migration-127 "negative stock guard" trigger
-- (trg_inventory_stock_negative_bu). Policy v1 for sale drawdown
-- (PR brief, user-confirmed): invoicing a linked product must NEVER fail
-- because of a stock-count drift — negative inventory_stock.quantity becomes
-- an explicit, allowed state (rendered in red in the UI) instead of a
-- blocking SQLSTATE '45000' error. Without dropping this trigger, any sale
-- that would take stock below zero would roll back the entire invoice-item
-- transaction with a raw MySQL error. DROP TRIGGER IF EXISTS is naturally
-- idempotent.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_390_inventory_product_linkage;
DELIMITER //
CREATE PROCEDURE migration_390_inventory_product_linkage()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plan_addons'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE plan_addons
      ADD COLUMN inventory_item_id BIGINT UNSIGNED NULL
          COMMENT 'Optional link to the inventory_items row this catalog product is backed by (migration 390)'
          AFTER addon_type,
      ADD KEY idx_plan_addons_inventory_item (inventory_item_id),
      ADD CONSTRAINT fk_plan_addons_inventory_item FOREIGN KEY (inventory_item_id)
          REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE invoice_items
      ADD COLUMN inventory_item_id BIGINT UNSIGNED NULL
          COMMENT 'Inventory item this line sold, if any — drives automatic stock drawdown (migration 390)'
          AFTER tax_rate_id,
      ADD KEY idx_invoice_items_inventory_item (inventory_item_id),
      ADD CONSTRAINT fk_invoice_items_inventory_item FOREIGN KEY (inventory_item_id)
          REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quote_items'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE quote_items
      ADD COLUMN inventory_item_id BIGINT UNSIGNED NULL
          COMMENT 'Inventory item this line represents — carried through to invoice_items on quote->invoice conversion (migration 390)'
          AFTER tax_rate_id,
      ADD KEY idx_quote_items_inventory_item (inventory_item_id),
      ADD CONSTRAINT fk_quote_items_inventory_item FOREIGN KEY (inventory_item_id)
          REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_390_inventory_product_linkage();
DROP PROCEDURE IF EXISTS migration_390_inventory_product_linkage;

-- ---------------------------------------------------------------------------
-- Drop the negative-stock guard trigger added by migration 127 — see header
-- comment above. Naturally idempotent (DROP ... IF EXISTS).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_inventory_stock_negative_bu;
