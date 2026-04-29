// =============================================================================
// FireISP 5.0 — AiProvider Model
// =============================================================================
// Stores LLM provider registrations (OpenAI, Azure OpenAI, Anthropic, Gemini,
// Ollama, custom). API keys are stored encrypted via src/utils/encryption.js
// and are never returned to callers outside llmProviderService.js.
// =============================================================================

const BaseModel = require('./BaseModel');

class AiProvider extends BaseModel {
  static get tableName() { return 'ai_providers'; }

  static get fillable() {
    return [
      'organization_id',
      'name',
      'kind',
      'model',
      'endpoint_url',
      'api_key_encrypted',
      'extra_config',
      'temperature',
      'max_tokens',
      'timeout_ms',
      'enabled',
      'priority',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = AiProvider;
