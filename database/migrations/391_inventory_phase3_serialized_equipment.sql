-- =============================================================================
-- Migration 391 — Inventory Phase 3: per-serial units, install drawdown
--               (rent/buy), pickup returns (§14.2 cont'd)
-- =============================================================================
-- User-confirmed design (PR brief):
--   1. inventory_items.serial_required — per-product toggle, DEFAULT OFF. OFF
--      keeps every existing Phase 1/2 quantity-only flow byte-for-byte
--      unchanged. ON enforces serial capture at PO receive and requires a
--      specific serial at install.
--   2. cpe_devices is reused as the per-serial unit registry (it already has
--      lifecycle_state in_stock/assigned/active/returned/rma and a
--      cpe_lifecycle_history audit trail via cpeInventoryService — see
--      migration 278). Two additions make a unit financially/commercially
--      meaningful outside its original TR-069-only purpose:
--        • inventory_item_id — which catalog product this serial IS.
--        • ownership          — rented|sold, set at install time.
--      cpe_devices.contract_id already exists (migration 274) — no change
--      needed there.
--   3. cpe_devices.oui is relaxed from NOT NULL to NULL. It was modelled as a
--      mandatory TR-069 CWMP DeviceId.OUI field, but Phase 3 mints units from
--      PO receipts and manual registration where no OUI is known (a
--      technician reads a serial off a box, not a CWMP Inform) — forcing a
--      fake placeholder OUI would corrupt that field's meaning for every
--      TR-069 consumer of this table (acsService, cpeDiagnosticsService).
--      NULL is the honest value. This ALSO changes the uniqueness
--      characteristics of uq_cpe_devices_serial_oui: MySQL treats each NULL
--      as distinct, so two inventory-sourced units that happen to share a
--      serial_number with oui both NULL would NOT collide at the DB layer.
--      Accepted trade-off (documented, not fixed here) — true global
--      uniqueness for non-TR-069 serials is a product-level policy decision
--      out of scope for this migration; per-organization duplicate serial
--      entry is still guarded in application code (inventorySerialService).
--   4. work_orders.work_type gains 'pickup' — the auto-created technician
--      follow-up when a contract with outstanding rented equipment is
--      cancelled/terminated (src/services/equipmentPickupService.js). No new
--      table: the pickup checklist is computed live from
--      cpe_devices WHERE contract_id = ? AND ownership = 'rented' AND
--      lifecycle_state IN ('assigned','active') — nothing to duplicate/drift.
--
-- No new permission slugs (brief: reuse cpe/inventory/service-order slugs).
-- What IS new here is granting the EXISTING cpe_devices.view/.create and
-- cpe_inventory.view/.manage permissions to the technician role, and the
-- EXISTING cpe_devices.view/cpe_inventory.view/cpe_lifecycle_history.view to
-- readonly — every cpe_* permission seeded by migrations 276/278 was
-- admin-only with NO grant to any other role at all, which would make this
-- entire Phase 3 flow (and the pre-existing CPE Inventory page, already
-- nav-visible to technicians per Layout.tsx) silently 403 for its primary
-- intended user. Fixing the technician grant is required for Phase 3 to work
-- end-to-end; the readonly grant is a low-risk, in-family bonus fix (CLAUDE.md
-- persona: "Readonly must see everything, change nothing, never crash").
-- cpe_inventory.link/.swap and cpe_devices.update/.delete remain admin-only —
-- flagged as a pre-existing gap, NOT fixed here (out of Phase 3's scope).
--
-- All ALTERs guarded via INFORMATION_SCHEMA (migration 371/374 pattern) so
-- re-running this file is a no-op on an already-migrated database.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_391_inventory_phase3_serialized_equipment;
DELIMITER //
CREATE PROCEDURE migration_391_inventory_phase3_serialized_equipment()
BEGIN
  -- ---------------------------------------------------------------------
  -- 1. inventory_items.serial_required
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'inventory_items'
      AND COLUMN_NAME  = 'serial_required'
  ) THEN
    ALTER TABLE inventory_items
      ADD COLUMN serial_required TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'When 1, this product is tracked per-serial via cpe_devices (PO receive requires serials, install requires picking one) — migration 391. Default 0 preserves pure-quantity Phase 1/2 behavior for every existing item.'
          AFTER category;
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. cpe_devices.inventory_item_id + ownership
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE cpe_devices
      ADD COLUMN inventory_item_id BIGINT UNSIGNED NULL
          COMMENT 'Which inventory_items catalog product this serial IS — set when the unit is created from a PO receive or manual registration (migration 391)'
          AFTER contract_id,
      ADD COLUMN ownership ENUM('rented','sold') NULL
          COMMENT 'Set at install time: rented = stays FireISP property (returned on pickup), sold = client property (never appears in a pickup checklist) — migration 391'
          AFTER inventory_item_id,
      ADD KEY idx_cpe_devices_inventory_item (inventory_item_id),
      ADD CONSTRAINT fk_cpe_devices_inventory_item FOREIGN KEY (inventory_item_id)
          REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- ---------------------------------------------------------------------
  -- 3. cpe_devices.oui NOT NULL -> NULL (see header comment)
  -- ---------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'oui'
      AND IS_NULLABLE  = 'NO'
  ) THEN
    ALTER TABLE cpe_devices
      MODIFY COLUMN oui VARCHAR(6) NULL COMMENT 'OUI from CWMP DeviceId.OUI (6 hex chars); NULL for units registered via inventory (PO receive / manual add / install-time type-new-serial) that have no known TR-069 identity yet (migration 391)';
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. work_orders.work_type — add 'pickup'
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'work_orders'
      AND COLUMN_NAME  = 'work_type'
      AND COLUMN_TYPE LIKE '%''pickup''%'
  ) THEN
    ALTER TABLE work_orders
      MODIFY COLUMN work_type ENUM('installation','maintenance','repair','survey','pickup','other') NOT NULL DEFAULT 'other'
          COMMENT 'Field-work classification (migrated from jobs.type); pickup = auto-created equipment-return follow-up on contract cancellation (migration 391)';
  END IF;
END //
DELIMITER ;
CALL migration_391_inventory_phase3_serialized_equipment();
DROP PROCEDURE IF EXISTS migration_391_inventory_phase3_serialized_equipment;

-- ---------------------------------------------------------------------------
-- 5. Permission grants — reuse existing slugs, no new ones (see header)
-- ---------------------------------------------------------------------------

-- technician: make the CPE inventory / Phase-3 install+pickup flow actually
-- usable (was 100% admin-only before this migration).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cpe_devices.view', 'cpe_devices.create',
  'cpe_inventory.view', 'cpe_inventory.manage'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: view-only bonus fix, same permission family, zero mutation risk.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cpe_devices.view', 'cpe_inventory.view', 'cpe_lifecycle_history.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
