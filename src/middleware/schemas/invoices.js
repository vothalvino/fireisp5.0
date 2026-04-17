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
};

const generateInvoice = {
  contract_id: { type: 'number', required: true, min: 1 },
};

const patchInvoice = { ...updateInvoice };

module.exports = { createInvoice, updateInvoice, patchInvoice, addInvoiceItem, generateInvoice };
