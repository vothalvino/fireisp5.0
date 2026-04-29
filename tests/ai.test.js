// =============================================================================
// FireISP 5.0 — AI REST Routes Tests (§5.1)
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Middleware mocks
// ---------------------------------------------------------------------------
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user   = { id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

// ---------------------------------------------------------------------------
// Service / model mocks
// ---------------------------------------------------------------------------

const mockAiPolicyFindByOrgId = jest.fn();
const mockAiPolicyUpsert      = jest.fn();
jest.mock('../src/models/AiPolicy', () => ({
  findByOrgId: (...a) => mockAiPolicyFindByOrgId(...a),
  upsert:      (...a) => mockAiPolicyUpsert(...a),
}));

const mockAiProviderFindById = jest.fn();
const mockAiProviderCreate   = jest.fn();
const mockAiProviderUpdate   = jest.fn();
const mockAiProviderDelete   = jest.fn();
jest.mock('../src/models/AiProvider', () => ({
  findById: (...a) => mockAiProviderFindById(...a),
  create:   (...a) => mockAiProviderCreate(...a),
  update:   (...a) => mockAiProviderUpdate(...a),
  delete:   (...a) => mockAiProviderDelete(...a),
}));

const mockAiReplyLogFindById = jest.fn();
const mockAiReplyLogUpdate   = jest.fn();
jest.mock('../src/models/AiReplyLog', () => ({
  findById: (...a) => mockAiReplyLogFindById(...a),
  update:   (...a) => mockAiReplyLogUpdate(...a),
}));

const mockPhraseList           = jest.fn();
const mockPhraseCreate         = jest.fn();
const mockPhraseUpdate         = jest.fn();
const mockPhraseDelete         = jest.fn();
const mockTermList             = jest.fn();
const mockTermCreate           = jest.fn();
const mockTermDelete           = jest.fn();
jest.mock('../src/services/phraseLibraryService', () => ({
  listPhrases:       (...a) => mockPhraseList(...a),
  createPhrase:      (...a) => mockPhraseCreate(...a),
  updatePhrase:      (...a) => mockPhraseUpdate(...a),
  deletePhrase:      (...a) => mockPhraseDelete(...a),
  listForbiddenTerms:  (...a) => mockTermList(...a),
  createForbiddenTerm: (...a) => mockTermCreate(...a),
  deleteForbiddenTerm: (...a) => mockTermDelete(...a),
}));

const mockLlmVerify  = jest.fn();
jest.mock('../src/services/llmProviderService', () => ({
  verify: (...a) => mockLlmVerify(...a),
}));

const mockAiGenerate = jest.fn();
jest.mock('../src/services/aiReplyService', () => ({
  generate: (...a) => mockAiGenerate(...a),
}));

jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => `enc:${v}`,
  decrypt: (v) => v.replace('enc:', ''),
}));

// ---------------------------------------------------------------------------
// Load app after all mocks
// ---------------------------------------------------------------------------
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POLICY = {
  organization_id: 1,
  enabled: 0,
  enabled_channels: { portal: false, email: false },
  mode: 'draft_only',
  tone: 'formal',
  default_locale: 'es-MX',
  redact_pii_before_llm: 1,
  active_provider_id: null,
};

const PROVIDER = {
  id: 1,
  organization_id: 1,
  name: 'OpenAI prod',
  kind: 'openai',
  model: 'gpt-4o-mini',
  endpoint_url: null,
  extra_config: null,
  temperature: 0.20,
  max_tokens: 800,
  timeout_ms: 20000,
  enabled: 1,
  priority: 100,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const PHRASE = {
  id: 1, organization_id: 1, locale: 'es-MX', category: 'greeting',
  text: 'Estimado cliente,', is_required: 0,
};

const TERM = {
  id: 1, organization_id: 1, locale: 'es-MX', term: 'no sé',
  replacement: 'investigaremos', deleted_at: null,
};

const LOG = {
  id: 10, organization_id: 1, ticket_id: 5, provider_id: 1,
  classification: 'billing', confidence: 0.92,
  draft_text: 'Estimado cliente, revisaremos su factura.',
  final_text: null, action: 'proposed',
  reviewer_user_id: null, cost_usd: 0.00012, duration_ms: 1234,
  created_at: '2026-04-01T10:00:00.000Z',
};

// =============================================================================
// Policy endpoints
// =============================================================================

describe('GET /api/v1/ai/policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiPolicyFindByOrgId.mockResolvedValue(POLICY);
  });

  it('returns 200 with the policy object', async () => {
    const res = await request(app).get('/api/v1/ai/policy');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: 0, mode: 'draft_only' });
    expect(mockAiPolicyFindByOrgId).toHaveBeenCalledWith(1);
  });
});

describe('PUT /api/v1/ai/policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiPolicyUpsert.mockResolvedValue({ ...POLICY, enabled: 1 });
  });

  it('returns 200 and the updated policy', async () => {
    const res = await request(app).put('/api/v1/ai/policy').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(1);
    expect(mockAiPolicyUpsert).toHaveBeenCalledWith(1, { enabled: true });
  });

  it('rejects invalid mode with 422', async () => {
    const res = await request(app).put('/api/v1/ai/policy').send({ mode: 'not_a_mode' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// Provider catalog
// =============================================================================

describe('GET /api/v1/ai/providers/catalog', () => {
  it('returns 200 with a list of provider kinds', async () => {
    const res = await request(app).get('/api/v1/ai/providers/catalog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const kinds = res.body.data.map(c => c.kind);
    expect(kinds).toContain('openai');
    expect(kinds).toContain('ollama');
    expect(kinds).toContain('anthropic');
  });

  it('each catalog entry has required fields', async () => {
    const res = await request(app).get('/api/v1/ai/providers/catalog');
    for (const entry of res.body.data) {
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('requiresApiKey');
      expect(entry).toHaveProperty('models');
    }
  });
});

// =============================================================================
// Providers CRUD
// =============================================================================

describe('GET /api/v1/ai/providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce([[PROVIDER]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
  });

  it('returns 200 with paginated provider list', async () => {
    const res = await request(app).get('/api/v1/ai/providers');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('does not include api_key_encrypted in the response', async () => {
    const res = await request(app).get('/api/v1/ai/providers');
    const row = res.body.data[0];
    expect(row).not.toHaveProperty('api_key_encrypted');
  });
});

describe('POST /api/v1/ai/providers', () => {
  const payload = {
    name: 'Test Provider',
    kind: 'openai',
    model: 'gpt-4o-mini',
    api_key: 'sk-test-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAiProviderCreate.mockResolvedValue({ ...PROVIDER, api_key_encrypted: 'enc:sk-test-key' });
  });

  it('returns 201 and encrypts the api_key', async () => {
    const res = await request(app).post('/api/v1/ai/providers').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('api_key_encrypted');
    const createCall = mockAiProviderCreate.mock.calls[0][0];
    expect(createCall.api_key_encrypted).toBe('enc:sk-test-key');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app).post('/api/v1/ai/providers').send({ kind: 'openai', model: 'gpt-4o' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when kind is not in the allowed list', async () => {
    const res = await request(app).post('/api/v1/ai/providers')
      .send({ name: 'x', kind: 'unknown_llm', model: 'x' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/ai/providers/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiProviderFindById
      .mockResolvedValueOnce(PROVIDER)             // first call (existence check)
      .mockResolvedValueOnce({ ...PROVIDER, model: 'gpt-4o', api_key_encrypted: null }); // after update
    mockAiProviderUpdate.mockResolvedValue(true);
  });

  it('returns 200 with updated provider (no key field)', async () => {
    const res = await request(app).put('/api/v1/ai/providers/1').send({ model: 'gpt-4o' });
    expect(res.status).toBe(200);
    expect(res.body.data.model).toBe('gpt-4o');
    expect(res.body.data).not.toHaveProperty('api_key_encrypted');
  });

  it('returns 404 when provider not found', async () => {
    mockAiProviderFindById.mockReset();
    mockAiProviderFindById.mockResolvedValue(null);
    const res = await request(app).put('/api/v1/ai/providers/999').send({ model: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/ai/providers/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiProviderFindById.mockResolvedValue(PROVIDER);
    mockAiProviderDelete.mockResolvedValue(true);
  });

  it('returns 204 No Content', async () => {
    const res = await request(app).delete('/api/v1/ai/providers/1');
    expect(res.status).toBe(204);
    expect(mockAiProviderDelete).toHaveBeenCalledWith(1);
  });

  it('returns 404 when provider not found', async () => {
    mockAiProviderFindById.mockResolvedValue(null);
    const res = await request(app).delete('/api/v1/ai/providers/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/ai/providers/:id/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiProviderFindById.mockResolvedValue(PROVIDER);
    mockLlmVerify.mockResolvedValue({ ok: true, model: 'gpt-4o-mini', latency_ms: 450 });
  });

  it('returns 200 with verification result', async () => {
    const res = await request(app).post('/api/v1/ai/providers/1/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.latency_ms).toBe(450);
    expect(mockLlmVerify).toHaveBeenCalledWith(1);
  });

  it('returns 404 when provider not found', async () => {
    mockAiProviderFindById.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/ai/providers/999/verify');
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// Phrase library
// =============================================================================

describe('GET /api/v1/ai/phrases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhraseList.mockResolvedValue({ data: [PHRASE], total: 1 });
  });

  it('returns 200 with phrase list', async () => {
    const res = await request(app).get('/api/v1/ai/phrases');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockPhraseList).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1 }));
  });

  it('passes locale and category filters', async () => {
    await request(app).get('/api/v1/ai/phrases?locale=es-MX&category=greeting');
    expect(mockPhraseList).toHaveBeenCalledWith(1, expect.objectContaining({
      locale: 'es-MX', category: 'greeting',
    }));
  });
});

describe('POST /api/v1/ai/phrases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhraseCreate.mockResolvedValue(PHRASE);
  });

  it('returns 201 with created phrase', async () => {
    const res = await request(app).post('/api/v1/ai/phrases')
      .send({ locale: 'es-MX', category: 'greeting', text: 'Estimado cliente,' });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('greeting');
  });

  it('returns 422 when text is missing', async () => {
    const res = await request(app).post('/api/v1/ai/phrases')
      .send({ locale: 'es-MX', category: 'greeting' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/ai/phrases/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhraseUpdate.mockResolvedValue({ ...PHRASE, text: 'Nuevo texto' });
  });

  it('returns 200 with updated phrase', async () => {
    const res = await request(app).put('/api/v1/ai/phrases/1').send({ text: 'Nuevo texto' });
    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe('Nuevo texto');
  });
});

describe('DELETE /api/v1/ai/phrases/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhraseDelete.mockResolvedValue(true);
  });

  it('returns 204', async () => {
    const res = await request(app).delete('/api/v1/ai/phrases/1');
    expect(res.status).toBe(204);
    expect(mockPhraseDelete).toHaveBeenCalledWith(1, '1');
  });
});

// =============================================================================
// Forbidden terms
// =============================================================================

describe('GET /api/v1/ai/forbidden-terms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTermList.mockResolvedValue({ data: [TERM], total: 1 });
  });

  it('returns 200 with term list', async () => {
    const res = await request(app).get('/api/v1/ai/forbidden-terms');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/v1/ai/forbidden-terms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTermCreate.mockResolvedValue(TERM);
  });

  it('returns 201 with created term', async () => {
    const res = await request(app).post('/api/v1/ai/forbidden-terms')
      .send({ locale: 'es-MX', term: 'no sé' });
    expect(res.status).toBe(201);
    expect(res.body.data.term).toBe('no sé');
  });

  it('returns 422 when locale is missing', async () => {
    const res = await request(app).post('/api/v1/ai/forbidden-terms').send({ term: 'no sé' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/ai/forbidden-terms/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTermDelete.mockResolvedValue(true);
  });

  it('returns 204', async () => {
    const res = await request(app).delete('/api/v1/ai/forbidden-terms/1');
    expect(res.status).toBe(204);
    expect(mockTermDelete).toHaveBeenCalledWith(1, '1');
  });
});

// =============================================================================
// Reply draft
// =============================================================================

describe('POST /api/v1/ai/reply/draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiGenerate.mockResolvedValue({
      skipped: false, logId: 10, draftText: 'Hola, revisaremos su caso.', action: 'proposed',
    });
  });

  it('returns 200 with generated draft', async () => {
    const res = await request(app).post('/api/v1/ai/reply/draft').send({
      ticket_id: 5, inbound_text: 'Mi internet no funciona', channel: 'portal',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.logId).toBe(10);
    expect(mockAiGenerate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 1, ticketId: 5, inboundText: 'Mi internet no funciona',
    }));
  });

  it('returns 200 with skipped result when policy is disabled', async () => {
    mockAiGenerate.mockResolvedValue({ skipped: true, reason: 'policy_disabled' });
    const res = await request(app).post('/api/v1/ai/reply/draft')
      .send({ ticket_id: 5, inbound_text: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data.skipped).toBe(true);
  });

  it('returns 422 when ticket_id is missing', async () => {
    const res = await request(app).post('/api/v1/ai/reply/draft')
      .send({ inbound_text: 'x' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when inbound_text is missing', async () => {
    const res = await request(app).post('/api/v1/ai/reply/draft')
      .send({ ticket_id: 1 });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// Reply send
// =============================================================================

describe('POST /api/v1/ai/reply/send', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiReplyLogFindById
      .mockResolvedValueOnce(LOG)
      .mockResolvedValueOnce({ ...LOG, final_text: 'Texto final', action: 'edited', reviewer_user_id: 1 });
    mockAiReplyLogUpdate.mockResolvedValue(true);
    mockQuery.mockResolvedValue([{ insertId: 99 }]);
  });

  it('returns 200 and posts a ticket comment when action is edited', async () => {
    const res = await request(app).post('/api/v1/ai/reply/send')
      .send({ log_id: 10, final_text: 'Texto final', action: 'edited' });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('edited');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ticket_comments'),
      expect.any(Array),
    );
  });

  it('does NOT post a comment when action is discarded', async () => {
    mockAiReplyLogFindById.mockReset();
    mockAiReplyLogFindById
      .mockResolvedValueOnce(LOG)
      .mockResolvedValueOnce({ ...LOG, action: 'discarded' });
    const res = await request(app).post('/api/v1/ai/reply/send')
      .send({ log_id: 10, final_text: 'n/a', action: 'discarded' });
    expect(res.status).toBe(200);
    // No INSERT INTO ticket_comments call
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO ticket_comments'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('returns 404 when log not found', async () => {
    mockAiReplyLogFindById.mockReset();
    mockAiReplyLogFindById.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/ai/reply/send')
      .send({ log_id: 999, final_text: 'x', action: 'sent' });
    expect(res.status).toBe(404);
  });

  it('returns 422 when action is not in the allowed list', async () => {
    const res = await request(app).post('/api/v1/ai/reply/send')
      .send({ log_id: 10, final_text: 'x', action: 'rejected' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// Logs
// =============================================================================

describe('GET /api/v1/ai/logs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce([[LOG]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
  });

  it('returns 200 with paginated logs', async () => {
    const res = await request(app).get('/api/v1/ai/logs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('applies ticket_id filter', async () => {
    await request(app).get('/api/v1/ai/logs?ticket_id=5');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('ticket_id = ?');
  });

  it('applies action filter', async () => {
    await request(app).get('/api/v1/ai/logs?action=auto_sent');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('action = ?');
  });
});

// =============================================================================
// Metrics
// =============================================================================

describe('GET /api/v1/ai/metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[{
      drafts_total: 100,
      auto_sent: 20,
      sent_or_edited: 65,
      discarded: 15,
      cost_usd_total: 0.012340,
      avg_duration_ms: 980,
    }]]);
  });

  it('returns 200 with aggregate metrics', async () => {
    const res = await request(app).get('/api/v1/ai/metrics');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.drafts_total).toBe(100);
    expect(d.auto_sent).toBe(20);
    expect(d.edit_rate).toBeCloseTo(0.65, 2);
    expect(d.auto_send_rate).toBeCloseTo(0.20, 2);
    expect(typeof d.cost_usd_total).toBe('number');
    expect(typeof d.date_from).toBe('string');
  });

  it('returns zero rates when no drafts', async () => {
    mockQuery.mockResolvedValue([[{
      drafts_total: 0, auto_sent: 0, sent_or_edited: 0, discarded: 0,
      cost_usd_total: 0, avg_duration_ms: 0,
    }]]);
    const res = await request(app).get('/api/v1/ai/metrics');
    expect(res.body.data.edit_rate).toBe(0);
    expect(res.body.data.auto_send_rate).toBe(0);
  });
});
