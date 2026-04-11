// =============================================================================
// FireISP 5.0 — Quote Validation Schemas
// =============================================================================

const createQuote = {
  client_id: { type: 'number', required: true, min: 1 },
  quote_number: { type: 'string', max: 50 },
  valid_until: { type: 'string' },
  subtotal: { type: 'number', min: 0 },
  tax_rate: { type: 'number', min: 0, max: 1 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'] },
};

const updateQuote = {
  client_id: { type: 'number', min: 1 },
  quote_number: { type: 'string', max: 50 },
  valid_until: { type: 'string' },
  subtotal: { type: 'number', min: 0 },
  tax_rate: { type: 'number', min: 0, max: 1 },
  tax_amount: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'] },
};

const createQuoteItem = {
  description: { type: 'string', required: true, min: 1, max: 255 },
  quantity: { type: 'number', required: true, min: 0 },
  unit_price: { type: 'number', required: true, min: 0 },
  amount: { type: 'number', required: true, min: 0 },
};

module.exports = { createQuote, updateQuote, createQuoteItem };
