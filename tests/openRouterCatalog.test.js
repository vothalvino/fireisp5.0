'use strict';
// =============================================================================
// FireISP 5.0 — OpenRouter live model catalog
// =============================================================================
// The point of this service is that the model list is NEVER hardcoded: a static
// list is stale within weeks and quietly denies operators the model they are
// paying for. That makes its failure behaviour the interesting part, because it
// depends on a third party being reachable:
//
//   • it must never throw — a provider form that 500s because openrouter.ai is
//     down is worse than one that degrades to a free-text field
//   • it must never call out on a schedule or at startup. FireISP is
//     self-hosted; an unrequested outbound call from a billing system fails a
//     security review, and an air-gapped install would log a failure forever
//   • "unknown price" and "free" must stay distinguishable. Collapsing them is
//     how a cost dashboard confidently reports zero
// =============================================================================

const catalog = require('../src/services/openRouterCatalog');

const MODEL = (id, prompt, completion, ctx = 1000) => ({
  id,
  name: `Name of ${id}`,
  context_length: ctx,
  pricing: { prompt: String(prompt), completion: String(completion) },
});

const okResponse = (models) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: models }),
});

let fetchMock;
beforeEach(() => {
  catalog._resetCache();
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});
afterEach(() => { delete global.fetch; });

describe('fetching and shaping the catalog', () => {
  it('returns the models, sorted by id', async () => {
    fetchMock.mockResolvedValue(okResponse([
      MODEL('zzz/last', '0.000001', '0.000002'),
      MODEL('aaa/first', '0.000003', '0.000004'),
    ]));
    const { models, error } = await catalog.getModels();
    expect(error).toBeNull();
    expect(models.map((m) => m.id)).toEqual(['aaa/first', 'zzz/last']);
  });

  it('keeps only the fields the picker and cost accounting need', async () => {
    fetchMock.mockResolvedValue(okResponse([{
      ...MODEL('a/b', '0.000001', '0.000002', 4096),
      description: 'x'.repeat(5000),
      architecture: { modality: 'text' },
    }]));
    const { models } = await catalog.getModels();
    // A 5 KB description per model, times ~340 models, shipped to every browser.
    expect(Object.keys(models[0]).sort()).toEqual(
      ['completion_price', 'context_length', 'free', 'id', 'name', 'prompt_price'],
    );
  });

  it('flags a model as free only when BOTH rates are known and zero', async () => {
    fetchMock.mockResolvedValue(okResponse([
      MODEL('free/one', '0', '0'),
      MODEL('paid/one', '0', '0.000002'),
      { id: 'unknown/one', name: 'u', context_length: 10, pricing: {} },
    ]));
    const { models } = await catalog.getModels();
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    expect(byId['free/one'].free).toBe(true);
    expect(byId['paid/one'].free).toBe(false);
    // Unknown must not render as free — that reads as "costs nothing".
    expect(byId['unknown/one'].free).toBe(false);
    expect(byId['unknown/one'].prompt_price).toBeNull();
  });

  it('drops entries with no usable id rather than rendering blanks', async () => {
    fetchMock.mockResolvedValue(okResponse([
      MODEL('good/one', '0.1', '0.2'), { name: 'no id' }, null, { id: '' },
    ]));
    const { models } = await catalog.getModels();
    expect(models.map((m) => m.id)).toEqual(['good/one']);
  });
});

describe('it never throws, whatever the upstream does', () => {
  it.each([
    ['a network error', () => { throw new Error('ECONNREFUSED'); }],
    ['a non-200', () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['a body with no data array', () => ({ ok: true, status: 200, json: async () => ({ oops: 1 }) })],
    ['an empty catalog', () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })],
  ])('reports %s as data, not an exception', async (_label, impl) => {
    fetchMock.mockImplementation(async () => impl());
    const result = await catalog.getModels();
    expect(result.models).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('keeps serving the last good catalog when a later refresh fails', async () => {
    // A stale list is far more useful than an empty picker.
    fetchMock.mockResolvedValueOnce(okResponse([MODEL('a/b', '0.1', '0.2')]));
    await catalog.getModels();

    fetchMock.mockRejectedValue(new Error('upstream down'));
    const result = await catalog.getModels({ force: true });
    expect(result.models.map((m) => m.id)).toEqual(['a/b']);
    expect(result.stale).toBe(true);
    expect(result.error).toMatch(/upstream down/);
  });
});

describe('caching keeps outbound calls rare', () => {
  it('serves a second call from memory without calling out again', async () => {
    fetchMock.mockResolvedValue(okResponse([MODEL('a/b', '0.1', '0.2')]));
    await catalog.getModels();
    await catalog.getModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers into ONE upstream request', async () => {
    // Several admins opening the form at once must not fan out into several
    // outbound calls.
    let release;
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(okResponse([MODEL('a/b', '0.1', '0.2')]));
    }));
    const all = Promise.all([catalog.getModels(), catalog.getModels(), catalog.getModels()]);
    await new Promise((r) => setImmediate(r));
    release();
    const results = await all;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.models.length === 1)).toBe(true);
  });

  it('force bypasses the cache', async () => {
    fetchMock.mockResolvedValue(okResponse([MODEL('a/b', '0.1', '0.2')]));
    await catalog.getModels();
    await catalog.getModels({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends no credentials and nothing identifying the install', async () => {
    fetchMock.mockResolvedValue(okResponse([MODEL('a/b', '0.1', '0.2')]));
    await catalog.getModels();
    const [, opts] = fetchMock.mock.calls[0];
    const headers = opts.headers || {};
    expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(['accept']);
  });

  it('does not call out when merely required — only when asked', async () => {
    // No timer, no startup fetch: an install that never touches OpenRouter must
    // never contact openrouter.ai.
    jest.resetModules();
    const fresh = jest.fn();
    global.fetch = fresh;
    require('../src/services/openRouterCatalog');
    expect(fresh).not.toHaveBeenCalled();
  });
});

describe('cost estimation from the live rates', () => {
  beforeEach(async () => {
    fetchMock.mockResolvedValue(okResponse([
      MODEL('paid/model', '0.00001', '0.00005'),
      MODEL('free/model', '0', '0'),
      { id: 'unpriced/model', name: 'u', context_length: 10, pricing: {} },
    ]));
    await catalog.getModels();
  });

  it('charges prompt and completion at their separate rates', () => {
    // 1000 * 0.00001 + 500 * 0.00005 = 0.01 + 0.025
    expect(catalog.estimateCost('paid/model', 1000, 500)).toBeCloseTo(0.035, 6);
  });

  it('returns 0 for a genuinely free model', () => {
    expect(catalog.estimateCost('free/model', 1000, 500)).toBe(0);
  });

  it('returns null — not 0 — when the model is unknown or unpriced', () => {
    // The caller must be able to tell "no charge" from "no idea".
    expect(catalog.estimateCost('not/in-catalog', 1000, 500)).toBeNull();
    expect(catalog.estimateCost('unpriced/model', 1000, 500)).toBeNull();
  });

  it('returns null when nothing has been fetched yet', () => {
    catalog._resetCache();
    expect(catalog.estimateCost('paid/model', 1000, 500)).toBeNull();
  });
});
