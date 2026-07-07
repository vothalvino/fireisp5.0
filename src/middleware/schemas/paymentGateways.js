// =============================================================================
// FireISP 5.0 — Payment Gateway Validation Schemas
// =============================================================================

const createPaymentGateway = {
  name: { type: 'string', required: true, max: 100 },
  provider: { type: 'string', required: true, enum: ['stripe', 'conekta', 'openpay', 'mercadopago', 'paypal', 'manual', 'other'] },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  public_key: { type: 'string', max: 500 },
  secret_key_encrypted: { type: 'string', max: 2000 },
  webhook_secret_encrypted: { type: 'string', max: 2000 },
  is_default: { type: 'boolean' },
  config_json: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updatePaymentGateway = {
  name: { type: 'string', max: 100 },
  provider: { type: 'string', enum: ['stripe', 'conekta', 'openpay', 'mercadopago', 'paypal', 'manual', 'other'] },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  public_key: { type: 'string', max: 500 },
  secret_key_encrypted: { type: 'string', max: 2000 },
  webhook_secret_encrypted: { type: 'string', max: 2000 },
  is_default: { type: 'boolean' },
  config_json: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createPaymentGateway, updatePaymentGateway };
