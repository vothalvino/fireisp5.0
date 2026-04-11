// =============================================================================
// FireISP 5.0 — Payment Gateway Validation Schemas
// =============================================================================

const createPaymentGateway = {
  provider: { type: 'string', required: true, enum: ['stripe', 'conekta', 'openpay', 'mercadopago', 'paypal', 'manual', 'other'] },
  label: { type: 'string', max: 255 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  public_key: { type: 'string', max: 500 },
  secret_key_encrypted: { type: 'string', max: 2000 },
  webhook_secret: { type: 'string', max: 500 },
  config: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updatePaymentGateway = {
  provider: { type: 'string', enum: ['stripe', 'conekta', 'openpay', 'mercadopago', 'paypal', 'manual', 'other'] },
  label: { type: 'string', max: 255 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  public_key: { type: 'string', max: 500 },
  secret_key_encrypted: { type: 'string', max: 2000 },
  webhook_secret: { type: 'string', max: 500 },
  config: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createPaymentGateway, updatePaymentGateway };
