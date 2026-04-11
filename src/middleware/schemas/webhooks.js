// =============================================================================
// FireISP 5.0 — Webhook Validation Schemas
// =============================================================================

const createWebhook = {
  url: { type: 'string', required: true, min: 1, max: 2000 },
  events: { type: 'string', required: true, max: 2000 },
  secret: { type: 'string', max: 255 },
  max_retries: { type: 'number', min: 0, max: 10 },
  timeout_seconds: { type: 'number', min: 1, max: 60 },
  is_enabled: { type: 'boolean' },
};

const updateWebhook = {
  url: { type: 'string', min: 1, max: 2000 },
  events: { type: 'string', max: 2000 },
  secret: { type: 'string', max: 255 },
  max_retries: { type: 'number', min: 0, max: 10 },
  timeout_seconds: { type: 'number', min: 1, max: 60 },
  is_enabled: { type: 'boolean' },
};

module.exports = { createWebhook, updateWebhook };
