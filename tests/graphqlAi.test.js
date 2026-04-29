// =============================================================================
// FireISP 5.0 — GraphQL AI Extension Tests (§5.2)
// =============================================================================
// Tests cover:
//   • Schema shape (all new types and fields exist)
//   • Query resolver unit tests (mocked DB / models)
//   • Mutation resolver unit test (aiDraftReply)
//   • Field resolver mappings (snake_case → camelCase, type coercions)
// =============================================================================

// ---------------------------------------------------------------------------
// Database / model / service mocks (must be declared before any require of
// the modules under test so Jest intercepts the require calls)
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

const mockAiPolicyFindByOrgId = jest.fn();
jest.mock('../src/models/AiPolicy', () => ({
  findByOrgId: (...a) => mockAiPolicyFindByOrgId(...a),
  upsert:      jest.fn(),
}));

const mockAiProviderFindById = jest.fn();
jest.mock('../src/models/AiProvider', () => ({
  findById: (...a) => mockAiProviderFindById(...a),
  create:   jest.fn(),
  update:   jest.fn(),
  delete:   jest.fn(),
}));

jest.mock('../src/models/AiPhrase', () => ({}));

const mockAiGenerate = jest.fn();
jest.mock('../src/services/aiReplyService', () => ({
  generate: (...a) => mockAiGenerate(...a),
}));

// LLM + phrase services referenced by resolvers.js at require-time — stub out
jest.mock('../src/services/llmProviderService', () => ({
  verify: jest.fn(),
}));
jest.mock('../src/services/phraseLibraryService', () => ({
  listPhrases:         jest.fn(),
  createPhrase:        jest.fn(),
  updatePhrase:        jest.fn(),
  deletePhrase:        jest.fn(),
  listForbiddenTerms:  jest.fn(),
  createForbiddenTerm: jest.fn(),
  deleteForbiddenTerm: jest.fn(),
}));
jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => `enc:${v}`,
  decrypt: (v) => v,
}));

// ---------------------------------------------------------------------------
// Load GraphQL modules under test
// ---------------------------------------------------------------------------
const { createSchema } = require('graphql-yoga');
const typeDefs  = require('../src/graphql/typeDefs');
const resolvers = require('../src/graphql/resolvers');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POLICY = {
  organization_id: 1,
  enabled: 1,
  enabled_channels: JSON.stringify({ portal: true, email: false, whatsapp: false, sms: false }),
  mode: 'draft_only',
  auto_send_confidence: '0.85',
  default_locale: 'es-MX',
  tone: 'formal',
  redact_pii_before_llm: 1,
  active_provider_id: 3,
};

const PROVIDER_ROW = {
  id: 1,
  organization_id: 1,
  name: 'OpenAI prod',
  kind: 'openai',
  model: 'gpt-4o-mini',
  endpoint_url: null,
  temperature: 0.20,
  max_tokens: 800,
  timeout_ms: 20000,
  enabled: 1,
  priority: 100,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const PHRASE_ROW = {
  id: 1,
  organization_id: 1,
  locale: 'es-MX',
  category: 'greeting',
  text: 'Estimado cliente,',
  is_required: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const LOG_ROW = {
  id: 10,
  ticket_id: 5,
  provider_id: 1,
  classification: 'billing',
  confidence: 0.92,
  draft_text: 'Revisaremos su factura.',
  final_text: null,
  action: 'proposed',
  reviewer_user_id: null,
  prompt_tokens: 400,
  completion_tokens: 120,
  cost_usd: 0.00012,
  duration_ms: 1234,
  error: null,
  created_at: '2026-04-01T10:00:00.000Z',
};

const CTX = { orgId: 1, user: { id: 1 } };

// =============================================================================
// Schema shape tests
// =============================================================================

describe('GraphQL AI — schema types and fields', () => {
  let schema;
  beforeAll(() => {
    schema = createSchema({ typeDefs, resolvers });
  });

  it('Query type has aiPolicy field', () => {
    const fields = schema.getQueryType().getFields();
    expect(fields).toHaveProperty('aiPolicy');
  });

  it('Query type has aiProviders field', () => {
    expect(schema.getQueryType().getFields()).toHaveProperty('aiProviders');
  });

  it('Query type has aiPhrases field', () => {
    expect(schema.getQueryType().getFields()).toHaveProperty('aiPhrases');
  });

  it('Query type has aiReplyLogs field', () => {
    expect(schema.getQueryType().getFields()).toHaveProperty('aiReplyLogs');
  });

  it('Mutation type has aiDraftReply field', () => {
    const mt = schema.getMutationType();
    expect(mt).not.toBeNull();
    expect(mt.getFields()).toHaveProperty('aiDraftReply');
  });

  it('AiPolicy type exists with expected fields', () => {
    const t = schema.getType('AiPolicy');
    expect(t).toBeDefined();
    const fieldNames = Object.keys(t.getFields());
    expect(fieldNames).toContain('enabled');
    expect(fieldNames).toContain('mode');
    expect(fieldNames).toContain('tone');
    expect(fieldNames).toContain('activeProviderId');
    expect(fieldNames).toContain('enabledChannels');
  });

  it('AiProvider type exists with expected fields', () => {
    const t = schema.getType('AiProvider');
    expect(t).toBeDefined();
    const fieldNames = Object.keys(t.getFields());
    expect(fieldNames).toContain('kind');
    expect(fieldNames).toContain('model');
    expect(fieldNames).toContain('enabled');
    expect(fieldNames).toContain('priority');
  });

  it('AiPhrase type exists', () => {
    expect(schema.getType('AiPhrase')).toBeDefined();
  });

  it('AiReplyLog type exists', () => {
    expect(schema.getType('AiReplyLog')).toBeDefined();
  });

  it('AiDraftReplyResult type has skipped + draftText fields', () => {
    const t = schema.getType('AiDraftReplyResult');
    expect(t).toBeDefined();
    const names = Object.keys(t.getFields());
    expect(names).toContain('skipped');
    expect(names).toContain('draftText');
    expect(names).toContain('reason');
    expect(names).toContain('logId');
  });

  it('AiChannels type has all four channel booleans', () => {
    const t = schema.getType('AiChannels');
    expect(t).toBeDefined();
    const names = Object.keys(t.getFields());
    expect(names).toContain('portal');
    expect(names).toContain('email');
    expect(names).toContain('whatsapp');
    expect(names).toContain('sms');
  });

  it('existing Query fields are untouched', () => {
    const fields = schema.getQueryType().getFields();
    expect(fields).toHaveProperty('client');
    expect(fields).toHaveProperty('tickets');
    expect(fields).toHaveProperty('invoices');
  });

  it('Subscription type still has ticketCommentAdded and deviceStatusChanged', () => {
    const fields = schema.getSubscriptionType().getFields();
    expect(fields).toHaveProperty('ticketCommentAdded');
    expect(fields).toHaveProperty('deviceStatusChanged');
  });
});

// =============================================================================
// Query resolver: aiPolicy
// =============================================================================

describe('Query.aiPolicy resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiPolicyFindByOrgId.mockResolvedValue(POLICY);
  });

  it('calls AiPolicy.findByOrgId with ctx.orgId and returns the result', async () => {
    const result = await resolvers.Query.aiPolicy(null, {}, CTX);
    expect(mockAiPolicyFindByOrgId).toHaveBeenCalledWith(1);
    expect(result).toBe(POLICY);
  });
});

// =============================================================================
// Query resolver: aiProviders
// =============================================================================

describe('Query.aiProviders resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[PROVIDER_ROW]]);
  });

  it('returns a list of providers without api_key_encrypted', async () => {
    const rows = await resolvers.Query.aiProviders(null, {}, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('openai');
    // Verify the SELECT does not include api_key_encrypted
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).not.toMatch(/api_key_encrypted/);
  });

  it('passes orgId parameter', async () => {
    await resolvers.Query.aiProviders(null, {}, CTX);
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain(1);
  });
});

// =============================================================================
// Query resolver: aiPhrases
// =============================================================================

describe('Query.aiPhrases resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[PHRASE_ROW]]);
  });

  it('returns rows from db query', async () => {
    const rows = await resolvers.Query.aiPhrases(null, {}, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('greeting');
  });

  it('applies locale filter when provided', async () => {
    await resolvers.Query.aiPhrases(null, { locale: 'es-MX' }, CTX);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/locale = \?/);
    expect(params).toContain('es-MX');
  });

  it('applies category filter when provided', async () => {
    await resolvers.Query.aiPhrases(null, { category: 'greeting' }, CTX);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/category = \?/);
    expect(params).toContain('greeting');
  });

  it('uses default limit when not specified', async () => {
    await resolvers.Query.aiPhrases(null, {}, CTX);
    const params = mockQuery.mock.calls[0][1];
    // second-to-last param is limit (50 default)
    expect(params[params.length - 2]).toBe(50);
  });
});

// =============================================================================
// Query resolver: aiReplyLogs
// =============================================================================

describe('Query.aiReplyLogs resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[LOG_ROW]]);
  });

  it('returns log rows scoped by orgId and ticketId', async () => {
    const rows = await resolvers.Query.aiReplyLogs(null, { ticketId: '5' }, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticket_id).toBe(5);
    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe(1); // orgId
    expect(params[1]).toBe('5'); // ticketId
  });
});

// =============================================================================
// Mutation resolver: aiDraftReply
// =============================================================================

describe('Mutation.aiDraftReply resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAiGenerate.mockResolvedValue({
      skipped: false, logId: 10, draftText: 'Hola, revisaremos su caso.', action: 'proposed',
    });
  });

  it('calls aiReplyService.generate with mapped arguments and returns the result', async () => {
    const result = await resolvers.Mutation.aiDraftReply(
      null,
      { ticketId: '5', inboundText: 'Mi internet no funciona', channel: 'portal' },
      CTX,
    );
    expect(mockAiGenerate).toHaveBeenCalledWith({
      orgId: 1, ticketId: 5, channel: 'portal', inboundText: 'Mi internet no funciona', contractId: null,
    });
    expect(result.draftText).toBe('Hola, revisaremos su caso.');
    expect(result.skipped).toBe(false);
  });

  it('defaults channel to portal when not supplied', async () => {
    await resolvers.Mutation.aiDraftReply(null, { ticketId: '5', inboundText: 'test' }, CTX);
    expect(mockAiGenerate).toHaveBeenCalledWith(expect.objectContaining({ channel: 'portal' }));
  });

  it('converts contractId string to number', async () => {
    await resolvers.Mutation.aiDraftReply(
      null, { ticketId: '5', inboundText: 'x', contractId: '99' }, CTX,
    );
    expect(mockAiGenerate).toHaveBeenCalledWith(expect.objectContaining({ contractId: 99 }));
  });

  it('returns skipped:true when policy is disabled', async () => {
    mockAiGenerate.mockResolvedValue({ skipped: true, reason: 'policy_disabled' });
    const result = await resolvers.Mutation.aiDraftReply(
      null, { ticketId: '5', inboundText: 'x' }, CTX,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('policy_disabled');
  });
});

// =============================================================================
// Field resolvers
// =============================================================================

describe('AiPolicy field resolvers', () => {
  it('maps snake_case fields correctly', () => {
    const r = resolvers.AiPolicy;
    expect(r.organizationId(POLICY)).toBe(1);
    expect(r.enabled(POLICY)).toBe(true);
    expect(r.autoSendConfidence(POLICY)).toBe('0.85');
    expect(r.defaultLocale(POLICY)).toBe('es-MX');
    expect(r.tone(POLICY)).toBe('formal');
    expect(r.redactPiiBeforeLlm(POLICY)).toBe(true);
    expect(r.activeProviderId(POLICY)).toBe(3);
  });

  it('parses enabledChannels JSON string', () => {
    const channels = resolvers.AiPolicy.enabledChannels(POLICY);
    expect(channels.portal).toBe(true);
    expect(channels.email).toBe(false);
    expect(channels.sms).toBe(false);
  });

  it('handles enabledChannels as object (not string)', () => {
    const p = { ...POLICY, enabled_channels: { portal: true, email: true, whatsapp: false, sms: false } };
    const channels = resolvers.AiPolicy.enabledChannels(p);
    expect(channels.email).toBe(true);
  });

  it('returns null for activeProviderId when null', () => {
    expect(resolvers.AiPolicy.activeProviderId({ active_provider_id: null })).toBeNull();
  });
});

describe('AiProvider field resolvers', () => {
  it('maps all fields', () => {
    const r = resolvers.AiProvider;
    expect(r.organizationId(PROVIDER_ROW)).toBe(1);
    expect(r.enabled(PROVIDER_ROW)).toBe(true);
    expect(r.priority(PROVIDER_ROW)).toBe(100);
    expect(r.temperature(PROVIDER_ROW)).toBe('0.2');
    expect(r.endpointUrl(PROVIDER_ROW)).toBeNull();
    expect(r.createdAt(PROVIDER_ROW)).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('AiPhrase field resolvers', () => {
  it('maps isRequired to boolean', () => {
    const r = resolvers.AiPhrase;
    expect(r.organizationId(PHRASE_ROW)).toBe(1);
    expect(r.isRequired(PHRASE_ROW)).toBe(true);
    expect(r.isRequired({ is_required: 0 })).toBe(false);
  });
});

describe('AiReplyLog field resolvers', () => {
  it('maps snake_case to camelCase', () => {
    const r = resolvers.AiReplyLog;
    expect(r.ticketId(LOG_ROW)).toBe(5);
    expect(r.providerId(LOG_ROW)).toBe(1);
    expect(r.draftText(LOG_ROW)).toBe('Revisaremos su factura.');
    expect(r.finalText(LOG_ROW)).toBeNull();
    expect(r.reviewerUserId(LOG_ROW)).toBeNull();
    expect(r.costUsd(LOG_ROW)).toBe('0.00012');
    expect(r.durationMs(LOG_ROW)).toBe(1234);
  });
});

describe('AiDraftReplyResult field resolvers', () => {
  it('maps skipped and optional fields', () => {
    const r = resolvers.AiDraftReplyResult;
    const payload = { skipped: false, logId: 10, draftText: 'Hello', action: 'proposed', reason: null };
    expect(r.skipped(payload)).toBe(false);
    expect(r.logId(payload)).toBe(10);
    expect(r.draftText(payload)).toBe('Hello');
    expect(r.reason(payload)).toBeNull();
  });

  it('returns null for optional fields when absent', () => {
    const r = resolvers.AiDraftReplyResult;
    const payload = { skipped: true, reason: 'policy_disabled' };
    expect(r.logId(payload)).toBeNull();
    expect(r.draftText(payload)).toBeNull();
    expect(r.action(payload)).toBeNull();
  });
});
