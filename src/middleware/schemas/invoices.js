// =============================================================================
// FireISP 5.0 — Invoice Validation Schemas
// =============================================================================

const createInvoice = {
  client_id: { type: 'number', required: true, min: 1 },
  contract_id: { type: 'number', min: 1 },
  invoice_number: { type: 'string', max: 50 },
  subtotal: { type: 'number', required: true, min: 0 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', max: 3 },
  tax_rate: { type: 'number', min: 0, max: 100 },
  tax_rate_id: { type: 'number', min: 1 },
  due_date: { type: 'string', required: true },
  status: { type: 'string', enum: ['draft', 'issued', 'paid', 'overdue', 'cancelled', 'void'] },
};

const updateInvoice = {
  invoice_number: { type: 'string', max: 50 },
  subtotal: { type: 'number', min: 0 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  currency: { type: 'string', max: 3 },
  tax_rate: { type: 'number', min: 0, max: 100 },
  tax_rate_id: { type: 'number', min: 1 },
  due_date: { type: 'string' },
  status: { type: 'string', enum: ['draft', 'issued', 'paid', 'overdue', 'cancelled', 'void'] },
};

const addInvoiceItem = {
  description: { type: 'string', required: true, min: 1, max: 500 },
  quantity: { type: 'number', required: true, min: 0 },
  unit_price: { type: 'number', required: true, min: 0 },
  amount: { type: 'number', required: true, min: 0 },
  tax_rate_id: { type: 'number', min: 1 },
  // Optional link to the inventory item this line sold (migration 390) —
  // when present, the route decrements stock and writes a ledger row in the
  // same transaction as the item insert. Org-ownership is verified in the
  // route handler (422 on cross-org/nonexistent), not here.
  inventory_item_id: { type: 'number', min: 1 },
};

const generateInvoice = {
  contract_id: { type: 'number', required: true, min: 1 },
};

const patchInvoice = Object.fromEntries(
  Object.entries(updateInvoice).map(([k, v]) => [k, { ...v, required: false }]),
);

// Stamp-later (invoice → CFDI 4.0). Both optional: uso_cfdi falls back to the
// client profile's default (then G03); forma_pago only applies to PUE (paid)
// invoices and falls back to the settling payment's sat_forma_pago.
const stampInvoice = {
  uso_cfdi: { type: 'string', max: 4 },
  forma_pago: { type: 'string', max: 2 },
};

module.exports = { createInvoice, updateInvoice, patchInvoice, addInvoiceItem, generateInvoice, stampInvoice };
