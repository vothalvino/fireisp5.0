// =============================================================================
// FireISP 5.0 — AI Reply Assistant Validation Schemas (§5.1)
// =============================================================================

const PROVIDER_KINDS = ['openai', 'azure_openai', 'anthropic', 'gemini', 'ollama', 'custom'];
const MODES          = ['draft_only', 'suggest', 'auto_send'];
const TONES          = ['formal', 'friendly', 'technical', 'empathetic'];
const CHANNELS       = ['portal', 'email', 'whatsapp', 'sms'];

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const updateAiPolicy = {
  enabled:                  { type: 'boolean' },
  enabled_channels:         { type: 'object' },
  mode:                     { type: 'string', enum: MODES },
  auto_send_confidence:     { type: 'number', min: 0, max: 1 },
  default_locale:           { type: 'string', max: 10 },
  tone:                     { type: 'string', enum: TONES },
  redact_pii_before_llm:    { type: 'boolean' },
  active_provider_id:       { type: 'number', min: 1 },
};

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const createAiProvider = {
  name:         { type: 'string', required: true, min: 1, max: 100 },
  kind:         { type: 'string', required: true, enum: PROVIDER_KINDS },
  model:        { type: 'string', required: true, min: 1, max: 100 },
  endpoint_url: { type: 'string', max: 500 },
  api_key:      { type: 'string', max: 1000 },
  temperature:  { type: 'number', min: 0, max: 2 },
  max_tokens:   { type: 'number', min: 1, max: 65536 },
  timeout_ms:   { type: 'number', min: 1000, max: 120000 },
  enabled:      { type: 'boolean' },
  priority:     { type: 'number', min: 0 },
};

const updateAiProvider = {
  name:         { type: 'string', min: 1, max: 100 },
  kind:         { type: 'string', enum: PROVIDER_KINDS },
  model:        { type: 'string', min: 1, max: 100 },
  endpoint_url: { type: 'string', max: 500 },
  api_key:      { type: 'string', max: 1000 },
  temperature:  { type: 'number', min: 0, max: 2 },
  max_tokens:   { type: 'number', min: 1, max: 65536 },
  timeout_ms:   { type: 'number', min: 1000, max: 120000 },
  enabled:      { type: 'boolean' },
  priority:     { type: 'number', min: 0 },
};

// ---------------------------------------------------------------------------
// Phrases
// ---------------------------------------------------------------------------

const createAiPhrase = {
  locale:      { type: 'string', required: true, min: 2, max: 10 },
  category:    { type: 'string', required: true, min: 1, max: 50 },
  text:        { type: 'string', required: true, min: 1, max: 5000 },
  is_required: { type: 'boolean' },
};

const updateAiPhrase = {
  locale:      { type: 'string', min: 2, max: 10 },
  category:    { type: 'string', min: 1, max: 50 },
  text:        { type: 'string', min: 1, max: 5000 },
  is_required: { type: 'boolean' },
};

// ---------------------------------------------------------------------------
// Forbidden terms
// ---------------------------------------------------------------------------

const createForbiddenTerm = {
  locale:      { type: 'string', required: true, min: 2, max: 10 },
  term:        { type: 'string', required: true, min: 1, max: 255 },
  replacement: { type: 'string', max: 255 },
};

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

const replyDraft = {
  ticket_id:    { type: 'number', required: true, min: 1 },
  channel:      { type: 'string', enum: CHANNELS },
  inbound_text: { type: 'string', required: true, min: 1, max: 20000 },
  contract_id:  { type: 'number', min: 1 },
};

const replySend = {
  log_id:     { type: 'number', required: true, min: 1 },
  final_text: { type: 'string', required: true, min: 1, max: 20000 },
  action:     { type: 'string', required: true, enum: ['sent', 'edited', 'discarded'] },
};

module.exports = {
  updateAiPolicy,
  createAiProvider,
  updateAiProvider,
  createAiPhrase,
  updateAiPhrase,
  createForbiddenTerm,
  replyDraft,
  replySend,
  PROVIDER_KINDS,
  CHANNELS,
};
