// =============================================================================
// FireISP 5.0 — Inventory Phase 3 Validation Schemas (serialized equipment)
// =============================================================================
// Manual serial registration, install-time assignment (rent/buy), and pickup
// disposition — see src/services/inventorySerialService.js for the business
// logic these gate.
// =============================================================================

const registerSerial = {
  inventory_item_id: { type: 'number', required: true, min: 1 },
  serial_number: { type: 'string', required: true, min: 1, max: 64 },
  warehouse_id: { type: 'number', required: false, min: 1 },
  manufacturer: { type: 'string', required: false, max: 100 },
  model_name: { type: 'string', required: false, max: 100 },
  notes: { type: 'string', required: false, max: 10000 },
  // Default (omitted/false) = catch-up: registers the unit without touching
  // inventory_stock.quantity (this is how pre-toggle unserialized stock gets
  // serialized organically, per PR brief item 2b). Explicit true = this is a
  // genuinely NEW unit that also increments quantity by 1 (with a 'receive'
  // ledger row) — for legacy devices being entered for the first time ever.
  increment_stock: { type: 'boolean', required: false },
};

const installEquipment = {
  contract_id: { type: 'number', required: true, min: 1 },
  service_order_id: { type: 'number', required: false, min: 1 },
  // Exactly one of cpe_device_id (pick an existing in-stock serial) or
  // new_serial (+ inventory_item_id, type-a-new-serial-at-install) must be
  // supplied — enforced by the route handler, not here (no cross-field rules
  // in validate()).
  cpe_device_id: { type: 'number', required: false, min: 1 },
  new_serial: { type: 'string', required: false, min: 1, max: 64 },
  inventory_item_id: { type: 'number', required: false, min: 1 },
  ownership: { type: 'string', required: true, enum: ['rented', 'sold'] },
};

const pickupDisposition = {
  cpe_device_id: { type: 'number', required: true, min: 1 },
  disposition: { type: 'string', required: true, enum: ['returned', 'rma'] },
  notes: { type: 'string', required: false, max: 10000 },
};

module.exports = { registerSerial, installEquipment, pickupDisposition };
