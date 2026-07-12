// =============================================================================
// FireISP 5.0 — Payment Validation Schemas
// =============================================================================

// Must match the DB `payments.payment_method` ENUM exactly (migrations 012,
// 074, 180 — see database/schema.sql). 'card'/'transfer'/'online' are the
// simplified generic values the frontend historically offered; the rest are
// the Mexico-specific instruments (SAT c_FormaPago-adjacent) added for CFDI
// pago complements: oxxo_pay, spei, codi, convenience_store, digital_wallet.
// A value here that isn't in the DB enum 422s here (safe); a DB enum value
// missing from here 422s on submit even though MySQL would accept it — that
// silent gap (missing card/transfer/online/oxxo_pay/spei/codi/
// convenience_store/digital_wallet) was the bug fixed by aligning this list.
const PAYMENT_METHODS = [
  'cash', 'check', 'card', 'transfer', 'online',
  'credit_card', 'debit_card', 'bank_transfer',
  'oxxo_pay', 'spei', 'codi', 'convenience_store',
  'digital_wallet', 'other',
];

const createPayment = {
  client_id: { type: 'number', required: true, min: 1 },
  amount: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', max: 3 },
  payment_method: { type: 'string', enum: PAYMENT_METHODS },
  payment_date: { type: 'string', format: 'date' },
  reference_number: { type: 'string', max: 200 },
  sat_forma_pago: { type: 'string', max: 2 },
  clabe: { type: 'string', max: 18 },
  bank_name: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'] },
};

const updatePayment = {
  amount: { type: 'number', min: 0 },
  currency: { type: 'string', max: 3 },
  payment_method: { type: 'string', enum: PAYMENT_METHODS },
  reference_number: { type: 'string', max: 200 },
  status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'] },
};

const allocatePayment = {
  invoice_id: { type: 'number', required: true, min: 1 },
  amount: { type: 'number', required: true, min: 0 },
};

const patchPayment = Object.fromEntries(
  Object.entries(updatePayment).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createPayment, updatePayment, patchPayment, allocatePayment };
