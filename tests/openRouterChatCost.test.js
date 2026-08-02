'use strict';
// =============================================================================
// FireISP 5.0 — an OpenRouter call must be priced, from a COLD cache
// =============================================================================
// This is the regression test for the defect that mattered most in this feature.
//
// estimateCost is a synchronous read of a module-level cache, and the only thing
// that ever filled that cache was an admin opening the AI settings page. The
// chat path never did. So in any process that had not served that page — a
// freshly restarted app, a second replica behind the load balancer, the
// background worker that actually drafts the replies — every OpenRouter call
// recorded $0 while OpenRouter was really billing, and the cost dashboard
// confidently reported zero spend.
//
// That is precisely the failure the adapter exists to prevent (the static
// PRICE_TABLE knows none of OpenRouter's namespaced ids), reintroduced by
// assuming a cache would be warm. So the test starts from a cold cache, which
// is the state every real process starts in.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const mockCreate = jest.fn();
const mockOpenAIOpts = [];
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(function OpenAIMock(opts) {
    mockOpenAIOpts.push(opts);
    this.chat = { completions: { create: mockCreate } };
  }),
}));
const lastOpenAIOpts = () => mockOpenAIOpts[mockOpenAIOpts.length - 1];

jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => v,
  decrypt: (v) => (v === null || v === undefined ? null : String(v).replace(/^enc:/, '')),
}));

const PROVIDER = {
  id: 7, organization_id: 1, kind: 'openrouter',
  model: 'anthropic/claude-sonnet-4.5',
  endpoint_url: null, api_key_encrypted: 'enc:sk-or-test',
  temperature: 0.2, max_tokens: 800, timeout_ms: 20000, enabled: 1, priority: 100,
};
jest.mock('../src/models/AiProvider', () => ({
  findById: jest.fn(async () => PROVIDER),
  findAll: jest.fn(async () => [PROVIDER]),
}));

const catalog = require('../src/services/openRouterCatalog');
const llm = require('../src/services/llmProviderService');

const CATALOG_BODY = {
  data: [{
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    context_length: 200000,
    // $3 / M in, $15 / M out — quoted per token, as OpenRouter does.
    pricing: { prompt: '0.000003', completion: '0.000015' },
  }],
};

let fetchMock;
beforeEach(() => {
  jest.clearAllMocks();
  mockOpenAIOpts.length = 0;
  catalog._resetCache(); // COLD — the state every process boots in.
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => CATALOG_BODY }));
  global.fetch = fetchMock;
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: 'hello' } }],
    usage: { prompt_tokens: 12000, completion_tokens: 3000 },
  });
});
afterEach(() => { delete global.fetch; });

describe('cost is real, not zero, on a cold process', () => {
  it('prices the call without anyone having opened the settings page first', async () => {
    const res = await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    // 12000 * 0.000003 + 3000 * 0.000015 = 0.036 + 0.045
    expect(res.cost_usd).toBeCloseTo(0.081, 6);
    expect(res.cost_usd).not.toBe(0);
  });

  it('fetches the catalog itself rather than relying on a warm cache', async () => {
    await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('records NULL — not 0 — when the model is genuinely not in the catalog', async () => {
    // "we could not price this" must stay distinguishable from "this was free",
    // or the cost dashboard reports a confident zero. ai_reply_logs.cost_usd is
    // nullable precisely so this is representable.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [
      { id: 'someone/else', name: 'x', context_length: 1, pricing: { prompt: '0.1', completion: '0.2' } },
    ] }) });
    const res = await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    expect(res.cost_usd).toBeNull();
  });

  it('still answers when the catalog is unreachable — priced as unknown', async () => {
    // A third party being down must not fail the reply itself.
    fetchMock.mockRejectedValue(new Error('offline'));
    const res = await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello');
    expect(res.cost_usd).toBeNull();
  });
});

describe('the adapter talks to OpenRouter, and only OpenRouter', () => {
  it('always uses the OpenRouter base URL', async () => {
    await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    expect(lastOpenAIOpts().baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('IGNORES a leftover endpoint_url instead of sending the key to it', async () => {
    // The form hides the endpoint field for this kind but did not clear it, so
    // switching an existing 'custom' provider to 'openrouter' carried the old
    // host along — and the freshly typed OpenRouter key was Bearer-sent there
    // while the row displayed as plain "OpenRouter". A field that is invisible
    // but obeyed is the same class of bug as one that is visible but dropped.
    require('../src/models/AiProvider').findById.mockResolvedValueOnce({
      ...PROVIDER, endpoint_url: 'http://10.0.0.5:8080/v1',
    });
    await llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] });
    expect(lastOpenAIOpts().baseURL).toBe('https://openrouter.ai/api/v1');
    expect(JSON.stringify(lastOpenAIOpts())).not.toContain('10.0.0.5');
  });

  it('treats a 200-with-error body as a failure, not an empty answer', async () => {
    // OpenRouter reports upstream rate limits and moderation refusals this way.
    // Swallowing it made "Test connection" report OK for a provider that cannot
    // answer — a stub that fakes success.
    mockCreate.mockResolvedValue({ error: { message: 'rate limited upstream', code: 429 } });
    await expect(
      llm.chat({ providerId: 7, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/rate limited upstream/);
  });
});

describe('embeddings fail with an explanation, not a 500', () => {
  it('says OpenRouter cannot embed rather than "Unknown provider kind"', async () => {
    // An org whose only provider is OpenRouter would otherwise see a 500 that
    // reads as a FireISP bug and sends the reader looking in the wrong place.
    await expect(llm.embed('x', 7)).rejects.toMatchObject({
      statusCode: 400,
      code: 'LLM_EMBED_NOT_SUPPORTED',
    });
  });
});
