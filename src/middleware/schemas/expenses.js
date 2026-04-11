// =============================================================================
// FireISP 5.0 — Expense Validation Schemas
// =============================================================================

const createExpense = {
  category: { type: 'string', required: true, max: 100 },
  description: { type: 'string', max: 5000 },
  amount: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', max: 3 },
  vendor: { type: 'string', max: 255 },
  receipt_url: { type: 'string', max: 500 },
  expense_date: { type: 'string' },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
};

const updateExpense = {
  category: { type: 'string', max: 100 },
  description: { type: 'string', max: 5000 },
  amount: { type: 'number', min: 0 },
  currency: { type: 'string', max: 3 },
  vendor: { type: 'string', max: 255 },
  receipt_url: { type: 'string', max: 500 },
  expense_date: { type: 'string' },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
};

module.exports = { createExpense, updateExpense };
