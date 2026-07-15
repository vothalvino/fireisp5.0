-- =============================================================================
-- Migration 392 — Inventory follow-ups: items sellable on invoices/quotes +
--                 undo-install (§14.2 cont'd)
-- =============================================================================
-- User-confirmed design (PR brief):
--   Feature A (items sellable directly) needs NO schema change — it only
--   extends the existing GET /inventory/items response (quantity_on_hand via
--   a grouped LEFT JOIN, same pattern as Plan.getAddons/migration 390) and
--   the invoice/quote product pickers. Also adds `plan_addons.description`
--   support at the app layer (the column already existed — migration 122 —
--   but the create route/schema silently dropped it).
--
--   Feature B (undo-install) needs exactly one new column:
--     • cpe_devices.sale_invoice_id — the invoice raised when a unit was
--       installed with ownership='sold' (billingService.createOneOffInvoice,
--       called from inventorySerialService.installEquipment). Undo-install
--       uses this to find and void the sale invoice (only when unpaid) as
--       part of reversing a mistaken install. Nullable FK, ON DELETE SET
--       NULL (mirrors every other cpe_devices FK in this table — losing the
--       invoice record must never block deleting/cleaning up a device row).
--       NULL for every unit installed before this migration (rented units,
--       and any sold unit installed pre-392) — undo-install treats a NULL
--       sale_invoice_id on a sold unit as "proceed, but warn: void the sale
--       invoice manually" rather than blocking the whole reversal.
--
-- No new tables, no new permission slugs — POST /cpe-management/devices/:id/
-- uninstall reuses the existing `cpe_inventory.manage` permission (already
-- granted to admin + technician by migration 391).
--
-- ALTER guarded via INFORMATION_SCHEMA (migration 371/374/391 pattern) so
-- re-running this file is a no-op on an already-migrated database.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_392_inventory_undo_install_and_sellable_items;
DELIMITER //
CREATE PROCEDURE migration_392_inventory_undo_install_and_sellable_items()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'sale_invoice_id'
  ) THEN
    ALTER TABLE cpe_devices
      ADD COLUMN sale_invoice_id BIGINT UNSIGNED NULL
          COMMENT 'The one-off invoice raised at install time when ownership=sold (billingService.createOneOffInvoice); NULL for rented units and for sold units installed before this migration — undo-install treats NULL as "proceed, warn: void manually" (migration 392)'
          AFTER ownership,
      ADD KEY idx_cpe_devices_sale_invoice (sale_invoice_id),
      ADD CONSTRAINT fk_cpe_devices_sale_invoice FOREIGN KEY (sale_invoice_id)
          REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_392_inventory_undo_install_and_sellable_items();
DROP PROCEDURE IF EXISTS migration_392_inventory_undo_install_and_sellable_items;
