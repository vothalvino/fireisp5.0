'use strict';
// =============================================================================
// FireISP 5.0 — OpenRouter as a first-class provider kind (migration 442)
// =============================================================================
// OpenRouter already worked through the generic 'custom' kind, because it speaks
// the OpenAI chat-completions shape. What a first-class kind adds is that the
// endpoint, the Bearer prefix and the model list stop being the operator's
// problem — so the things worth testing are the seams where that convenience
// could silently be wrong:
//
//   • the kind must exist in BOTH the validation schema and the DB ENUM. A slug
//     accepted by validate() but rejected by MySQL is a 500 at write time; one
//     in the ENUM but missing from the schema is a 422 nobody can explain.
//     Column names and ENUM values are the API contract in this codebase.
//   • the model list must be LIVE. A static list here would defeat the entire
//     feature, so the catalog entry must advertise dynamicModels and ship no
//     models of its own.
//   • the live endpoint must be reachable — declared before /:id, which would
//     otherwise swallow it as an id.
//   • an upstream outage must not 5xx the provider form.
// =============================================================================

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue([[]]),
  queryReplica: jest.fn().mockResolvedValue([[]]),
  execute: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; req.userId = 1; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist: () => [],
}));

const mockGetModels = jest.fn();
jest.mock('../src/services/openRouterCatalog', () => ({
  getModels: (...a) => mockGetModels(...a),
  estimateCost: jest.fn(),
}));

const app = require('../src/app');
const { PROVIDER_KINDS } = require('../src/middleware/schemas/ai');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetModels.mockResolvedValue({
    models: [{ id: 'anthropic/claude-x', name: 'Claude X', context_length: 200000, prompt_price: 0.000003, completion_price: 0.000015, free: false }],
    error: null, cached_at: 1, stale: false,
  });
});

const get = (url) => request(app).get(url).set('Authorization', 'Bearer test');

describe('the kind is declared consistently across the stack', () => {
  it('validate() accepts openrouter', () => {
    expect(PROVIDER_KINDS).toContain('openrouter');
  });

  it('the DB ENUM accepts every kind validate() does', () => {
    // The classic break: a slug that passes validation and then 500s on INSERT
    // because MySQL rejects it. Read from schema.sql rather than trusting both
    // lists to have been edited together.
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS ai_providers'));
    const enumDecl = table.slice(table.indexOf('kind'), table.indexOf('model'));
    const values = [...enumDecl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const kind of PROVIDER_KINDS) {
      expect(values).toContain(kind);
    }
  });

  it('the migration appends the value rather than reordering the ENUM', () => {
    // MySQL stores an ENUM as the ordinal index of its value, so inserting a
    // value anywhere but the end silently relabels every existing row.
    const mig = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '442_openrouter_provider_kind.sql'), 'utf8',
    );
    expect(mig).toMatch(/ENUM\('openai','azure_openai','anthropic','gemini','ollama','custom','openrouter'\)/);
  });

  it('the dispatch switch handles it, so it cannot 500 as an unknown kind', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'llmProviderService.js'), 'utf8');
    const dispatch = src.slice(src.indexOf('async function _callProviderOnce'));
    expect(dispatch).toMatch(/case 'openrouter':/);
  });

  it('the catalog advertises every kind validate() accepts', async () => {
    // The UI renders its kind dropdown and per-kind fields straight from
    // GET /providers/catalog (j62), so the catalog IS the UI's kind list —
    // a kind accepted by validation but missing here simply never appears in
    // the dropdown, silently. This replaces the old grep of the frontend's
    // own PROVIDER_KINDS copy, which j62 deleted.
    const res = await get('/api/v1/ai/providers/catalog');
    const catalogKinds = res.body.data.map((k) => k.kind);
    for (const kind of PROVIDER_KINDS) {
      expect(catalogKinds).toContain(kind);
    }
    // Every entry must carry what the form needs to render it.
    for (const entry of res.body.data) {
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.requiresApiKey).toBe('boolean');
      expect(typeof entry.requiresEndpoint).toBe('boolean');
      expect(Array.isArray(entry.models)).toBe(true);
    }
  });

  it('the UI reads the catalog instead of keeping its own kind list', () => {
    // Anti-regression for j62: a reintroduced local PROVIDER_KINDS/KIND_FIELDS
    // constant would drift silently again.
    const page = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'pages', 'AIAssistantSettings.tsx'), 'utf8',
    );
    expect(page).toContain('/providers/catalog');
    expect(page).not.toMatch(/^const PROVIDER_KINDS/m);
    expect(page).not.toMatch(/^const KIND_FIELDS/m);
  });
});

describe('GET /ai/providers/catalog advertises a live model list', () => {
  it('includes OpenRouter and does not require an endpoint', async () => {
    const res = await get('/api/v1/ai/providers/catalog');
    const entry = res.body.data.find((k) => k.kind === 'openrouter');
    expect(entry).toBeDefined();
    expect(entry.requiresEndpoint).toBe(false);
    expect(entry.requiresApiKey).toBe(true);
  });

  it('ships NO hardcoded models for it, only the dynamic flag', () => {
    // A static list is stale within weeks — the whole point of this feature.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'ai.js'), 'utf8');
    const block = src.slice(src.indexOf("kind: 'openrouter'"), src.indexOf("kind: 'custom'"));
    expect(block).toMatch(/dynamicModels: true/);
    expect(block).toMatch(/models: \[\]/);
  });
});

describe('GET /ai/providers/models serves the live catalog', () => {
  it('returns the models', async () => {
    const res = await get('/api/v1/ai/providers/models?kind=openrouter');
    expect(res.status).toBe(200);
    expect(res.body.data.models[0].id).toBe('anthropic/claude-x');
    expect(res.body.data.kind).toBe('openrouter');
  });

  it('defaults to openrouter when no kind is given', async () => {
    const res = await get('/api/v1/ai/providers/models');
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('openrouter');
  });

  it('is reachable — i.e. declared before /:id', async () => {
    // A literal path after a param route is unreachable; "models" would be
    // parsed as an id. 200 (not 404/422) proves the ordering.
    const res = await get('/api/v1/ai/providers/models');
    expect(res.status).toBe(200);
    expect(mockGetModels).toHaveBeenCalled();
  });

  it('400s for a kind that has no live catalog, pointing at the static one', async () => {
    const res = await get('/api/v1/ai/providers/models?kind=openai');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_KIND');
    expect(res.body.error.message).toMatch(/catalog/);
    expect(mockGetModels).not.toHaveBeenCalled();
  });

  it('passes force=1 through to bypass the cache', async () => {
    await get('/api/v1/ai/providers/models?force=1');
    expect(mockGetModels).toHaveBeenCalledWith({ force: true });
  });

  it('does not force by default', async () => {
    await get('/api/v1/ai/providers/models');
    expect(mockGetModels).toHaveBeenCalledWith({ force: false });
  });

  it('reports an upstream outage as 200 + error, never 5xx', async () => {
    // The picker degrades to a free-text field; a third party being down must
    // not make the provider form unusable.
    mockGetModels.mockResolvedValue({ models: [], error: 'upstream down', cached_at: 1, stale: false });
    const res = await get('/api/v1/ai/providers/models');
    expect(res.status).toBe(200);
    expect(res.body.data.models).toEqual([]);
    expect(res.body.data.error).toBe('upstream down');
  });

  it('surfaces staleness so the UI can say the list may be out of date', async () => {
    mockGetModels.mockResolvedValue({ models: [{ id: 'a/b' }], error: 'refresh failed', cached_at: 1, stale: true });
    const res = await get('/api/v1/ai/providers/models');
    expect(res.body.data.stale).toBe(true);
    expect(res.body.data.models).toHaveLength(1);
  });
});
