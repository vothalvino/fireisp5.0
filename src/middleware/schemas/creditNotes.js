// =============================================================================
// FireISP 5.0 — Credit Note Validation Schemas
// =============================================================================

const createCreditNote = {
  client_id: { type: 'number', required: true, min: 1 },
  invoice_id: { type: 'number', min: 1 },
  credit_note_number: { type: 'string', max: 50 },
  reason: { type: 'string', enum: ['billing_error', 'service_interruption', 'overpayment', 'promotional_credit', 'contract_cancellation', 'other'] },
  subtotal: { type: 'number', min: 0 },
  tax_rate: { type: 'number', min: 0, max: 1 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'issued', 'applied', 'cancelled'] },
};

const updateCreditNote = {
  invoice_id: { type: 'number', min: 1 },
  credit_note_number: { type: 'string', max: 50 },
  reason: { type: 'string', enum: ['billing_error', 'service_interruption', 'overpayment', 'promotional_credit', 'contract_cancellation', 'other'] },
  subtotal: { type: 'number', min: 0 },
  tax_rate: { type: 'number', min: 0, max: 1 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'issued', 'applied', 'cancelled'] },
};

const createCreditNoteItem = {
  description: { type: 'string', required: true, min: 1, max: 255 },
  quantity: { type: 'number', required: true, min: 0 },
  unit_price: { type: 'number', required: true, min: 0 },
  amount: { type: 'number', required: true, min: 0 },
};

module.exports = { createCreditNote, updateCreditNote, createCreditNoteItem };
