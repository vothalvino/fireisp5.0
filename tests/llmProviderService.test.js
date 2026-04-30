// =============================================================================
// FireISP 5.0 — llmProviderService Tests (P1 §3.4)
// =============================================================================
// All external SDK calls and DB calls are mocked.
// =============================================================================

// ---------------------------------------------------------------------------
// Database / model mocks
// ---------------------------------------------------------------------------
const mockProviderFindById  = jest.fn();
const mockProviderFindAll   = jest.fn();

jest.mock('../src/models/AiProvider', () => ({
  findById: mockProviderFindById,
  findAll:  mockProviderFindAll,
}));

// ---------------------------------------------------------------------------
// Encryption mock — return plaintext key unchanged in tests
// ---------------------------------------------------------------------------
jest.mock('../src/utils/encryption', () => ({
  decrypt: v => v,
  encrypt: v => v,
  getKey:  () => null,
}));

// ---------------------------------------------------------------------------
// OpenAI SDK mock
// ---------------------------------------------------------------------------
const mockOpenAICreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockOpenAICreate,
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Anthropic SDK mock
// ---------------------------------------------------------------------------
const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

// ---------------------------------------------------------------------------
// Gemini SDK mock
// ---------------------------------------------------------------------------
const mockSendMessage = jest.fn();
const mockStartChat   = jest.fn().mockReturnValue({ sendMessage: mockSendMessage });
const mockGetGenerativeModel = jest.fn().mockReturnValue({ startChat: mockStartChat });
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// ---------------------------------------------------------------------------
// global.fetch mock (for ollama + custom)
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Load service AFTER all mocks are in place
// ---------------------------------------------------------------------------
const svc = require('../src/services/llmProviderService');

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BASE_PROVIDER = {
  id: 1, organization_id: 1,
  name: 'Test Provider',
  kind: 'openai',
  model: 'gpt-4o-mini',
  endpoint_url: null,
  api_key_encrypted: 'sk-test',
  extra_config: null,
  temperature: 0.2,
  max_tokens: 800,
  timeout_ms: 5000,
  enabled: 1,
  priority: 100,
};

const MESSAGES = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user',   content: 'Hello!' },
];

afterEach(() => jest.clearAllMocks());

// =============================================================================
// _computeCost
// =============================================================================

describe('llmProviderService._computeCost', () => {
  it('computes cost for a known model', () => {
    // gpt-4o-mini = $0.00015 / 1000 tokens
    const cost = svc._computeCost('openai', 'gpt-4o-mini', 500, 300);
    expect(cost).toBeCloseTo(0.00015 * 0.8, 8); // (500+300)/1000 * 0.00015
  });

  it('returns 0 for local / zero-cost models', () => {
    expect(svc._computeCost('ollama', 'llama3.1:8b', 1000, 1000)).toBe(0);
  });

  it('returns 0 for unknown model (warning logged)', () => {
    expect(svc._computeCost('openai', 'unknown-model-xyz', 1000, 1000)).toBe(0);
  });
});

// =============================================================================
// _parseJson
// =============================================================================

describe('llmProviderService._parseJson', () => {
  it('parses plain JSON', () => {
    expect(svc._parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips markdown code fences', () => {
    expect(svc._parseJson('```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(svc._parseJson('```\n{"c":3}\n```')).toEqual({ c: 3 });
  });

  it('returns null for invalid JSON', () => {
    expect(svc._parseJson('not json')).toBeNull();
  });

  it('returns null for empty / null input', () => {
    expect(svc._parseJson('')).toBeNull();
    expect(svc._parseJson(null)).toBeNull();
  });
});

// =============================================================================
// chat() — OpenAI provider
// =============================================================================

describe('llmProviderService.chat — openai', () => {
  beforeEach(() => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'openai' });
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello there!' } }],
      usage:   { prompt_tokens: 20, completion_tokens: 5 },
    });
  });

  it('returns text, usage, and cost_usd', async () => {
    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Hello there!');
    expect(res.usage.prompt_tokens).toBe(20);
    expect(res.usage.completion_tokens).toBe(5);
    expect(typeof res.cost_usd).toBe('number');
    expect(res.json).toBeNull(); // no jsonSchema
  });

  it('parses JSON when jsonSchema is provided', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"yes"}' } }],
      usage:   { prompt_tokens: 15, completion_tokens: 10 },
    });
    const res = await svc.chat({ providerId: 1, messages: MESSAGES, jsonSchema: { type: 'object' } });
    expect(res.json).toEqual({ answer: 'yes' });
    // json_object response_format should be set
    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
      expect.anything(),
    );
  });

  it('throws when providerId is missing', async () => {
    await expect(svc.chat({ messages: MESSAGES })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when messages is empty', async () => {
    await expect(svc.chat({ providerId: 1, messages: [] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when provider not found', async () => {
    mockProviderFindById.mockResolvedValue(null);
    await expect(svc.chat({ providerId: 999, messages: MESSAGES })).rejects.toMatchObject({ statusCode: 404 });
  });
});

// =============================================================================
// chat() — azure_openai provider
// =============================================================================

describe('llmProviderService.chat — azure_openai', () => {
  it('constructs client with baseURL and api-version', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER,
      kind: 'azure_openai',
      endpoint_url: 'https://my-azure.openai.azure.com',
      extra_config: JSON.stringify({ api_version: '2024-05-01-preview' }),
    });
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'Azure response' } }],
      usage:   { prompt_tokens: 10, completion_tokens: 5 },
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Azure response');

    const { OpenAI } = require('openai');
    const constructorCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(constructorCall.baseURL).toBe('https://my-azure.openai.azure.com');
    expect(constructorCall.defaultQuery['api-version']).toBe('2024-05-01-preview');
  });
});

// =============================================================================
// chat() — anthropic provider
// =============================================================================

describe('llmProviderService.chat — anthropic', () => {
  it('returns text and usage from Anthropic response', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'anthropic', model: 'claude-3-5-haiku-20241022' });
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Anthropic answer' }],
      usage:   { input_tokens: 30, output_tokens: 10 },
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Anthropic answer');
    expect(res.usage.prompt_tokens).toBe(30);
    expect(res.usage.completion_tokens).toBe(10);
  });

  it('separates system message from conversation turns', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'anthropic', model: 'claude-3-5-haiku-20241022' });
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage:   { input_tokens: 5, output_tokens: 2 },
    });

    await svc.chat({ providerId: 1, messages: MESSAGES });

    const callArgs = mockAnthropicCreate.mock.calls[0][0];
    // System message should NOT be in the messages array
    expect(callArgs.messages.every(m => m.role !== 'system')).toBe(true);
    // System content passed via `system` field
    expect(callArgs.system).toContain('You are a helpful assistant.');
  });
});

// =============================================================================
// chat() — gemini provider
// =============================================================================

describe('llmProviderService.chat — gemini', () => {
  it('returns text from Gemini response', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'gemini', model: 'gemini-1.5-flash' });
    mockSendMessage.mockResolvedValue({
      response: {
        text:          () => 'Gemini answer',
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
      },
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Gemini answer');
    expect(res.usage.prompt_tokens).toBe(12);
    expect(res.usage.completion_tokens).toBe(4);
  });
});

// =============================================================================
// chat() — ollama provider
// =============================================================================

describe('llmProviderService.chat — ollama', () => {
  it('posts to the ollama /api/chat endpoint and returns result', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER,
      kind: 'ollama',
      model: 'llama3.1:8b',
      endpoint_url: 'http://localhost:11434',
      api_key_encrypted: null,
    });
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({
        message:          { content: 'Ollama answer' },
        prompt_eval_count: 8,
        eval_count:        3,
      }),
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Ollama answer');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.cost_usd).toBe(0); // local model
  });

  it('throws on HTTP error from ollama', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER, kind: 'ollama', model: 'llama3.1:8b',
    });
    mockProviderFindAll.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal error' });

    await expect(svc.chat({ providerId: 1, messages: MESSAGES })).rejects.toMatchObject({ statusCode: 502 });
  });
});

// =============================================================================
// chat() — custom provider
// =============================================================================

describe('llmProviderService.chat — custom', () => {
  it('sends request with org-defined headers', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER,
      kind: 'custom',
      model: 'my-model',
      endpoint_url: 'https://my-api.example.com/v1/chat',
      extra_config: JSON.stringify({ headers: { 'X-Custom-Header': 'secret-value' } }),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Custom response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Custom response');

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].headers['X-Custom-Header']).toBe('secret-value');
  });

  it('applies custom auth header with prefix', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER,
      kind: 'custom',
      model: 'my-model',
      endpoint_url: 'https://custom.example.com/chat',
      extra_config: JSON.stringify({ auth_header: 'x-api-key', auth_prefix: null }),
      api_key_encrypted: 'my-api-key',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    });

    await svc.chat({ providerId: 1, messages: MESSAGES });
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].headers['x-api-key']).toBe('my-api-key');
  });

  it('throws on non-ok HTTP response', async () => {
    mockProviderFindById.mockResolvedValue({
      ...BASE_PROVIDER, kind: 'custom', endpoint_url: 'https://example.com/chat',
    });
    mockProviderFindAll.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' });

    await expect(svc.chat({ providerId: 1, messages: MESSAGES })).rejects.toMatchObject({ statusCode: 502 });
  });
});

// =============================================================================
// Retry behaviour
// =============================================================================

describe('llmProviderService.chat — retry', () => {
  it('retries up to 3 times then falls back to other providers', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'openai' });
    // Primary fails all 3 retries
    mockOpenAICreate.mockRejectedValue(new Error('Upstream 503'));
    // No fallback providers
    mockProviderFindAll.mockResolvedValue([]);

    await expect(svc.chat({ providerId: 1, messages: MESSAGES })).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('All LLM providers failed'),
    });

    expect(mockOpenAICreate).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it('succeeds on second attempt after transient failure', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'openai' });
    mockOpenAICreate
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'second try ok' } }],
        usage:   { prompt_tokens: 10, completion_tokens: 5 },
      });
    mockProviderFindAll.mockResolvedValue([]);

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('second try ok');
    expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
  });
}, 20000); // allow time for back-off

// =============================================================================
// Fallback chain
// =============================================================================

describe('llmProviderService.chat — fallback chain', () => {
  it('uses fallback provider when primary fails all retries', async () => {
    const primary  = { ...BASE_PROVIDER, id: 1, kind: 'openai',   priority: 100 };
    const fallback = { ...BASE_PROVIDER, id: 2, kind: 'anthropic', priority: 200,
      model: 'claude-3-5-haiku-20241022' };

    mockProviderFindById.mockResolvedValue(primary);
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));
    mockProviderFindAll.mockResolvedValue([primary, fallback]);
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Fallback reply' }],
      usage:   { input_tokens: 10, output_tokens: 5 },
    });

    const res = await svc.chat({ providerId: 1, messages: MESSAGES });
    expect(res.text).toBe('Fallback reply');
    // Primary was tried (3x), then fallback once
    expect(mockOpenAICreate).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  }, 10000);

  it('throws when all fallbacks also fail', async () => {
    const primary  = { ...BASE_PROVIDER, id: 1, kind: 'openai',   priority: 100 };
    const fallback = { ...BASE_PROVIDER, id: 2, kind: 'anthropic', priority: 200,
      model: 'claude-3-5-haiku-20241022' };

    mockProviderFindById.mockResolvedValue(primary);
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));
    mockProviderFindAll.mockResolvedValue([primary, fallback]);
    mockAnthropicCreate.mockRejectedValue(new Error('Anthropic down'));

    await expect(svc.chat({ providerId: 1, messages: MESSAGES })).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('All LLM providers failed'),
    });
  }, 15000);
});

// =============================================================================
// verify()
// =============================================================================

describe('llmProviderService.verify', () => {
  it('returns ok=true with model and latency_ms on success', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'openai' });
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage:   { prompt_tokens: 3, completion_tokens: 1 },
    });

    const res = await svc.verify(1);
    expect(res.ok).toBe(true);
    expect(res.model).toBe('gpt-4o-mini');
    expect(typeof res.latency_ms).toBe('number');
  });

  it('throws AppError when provider not found', async () => {
    mockProviderFindById.mockResolvedValue(null);
    await expect(svc.verify(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws AppError (502) when call fails', async () => {
    mockProviderFindById.mockResolvedValue({ ...BASE_PROVIDER, kind: 'openai' });
    mockOpenAICreate.mockRejectedValue(new Error('network error'));
    await expect(svc.verify(1)).rejects.toMatchObject({ statusCode: 502 });
  });
});
