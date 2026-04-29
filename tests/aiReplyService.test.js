// =============================================================================
// FireISP 5.0 — aiReplyService Tests (P1 §3.5)
// =============================================================================
// All external calls (DB, LLM, topology, health) are mocked so tests run
// in isolation without a database.
// =============================================================================

// ---------------------------------------------------------------------------
// Model mocks
// ---------------------------------------------------------------------------
const mockFindByOrgId     = jest.fn();
const mockPolicyUpsert    = jest.fn();
const mockReplyLogCreate  = jest.fn();
const mockReplyLogUpdate  = jest.fn();
const mockTicketFindById  = jest.fn();
const mockTicketGetComments = jest.fn();
const mockTicketAddComment  = jest.fn();
const mockTicketCommentCreate = jest.fn();
const mockNotificationCreate  = jest.fn();

jest.mock('../src/models/AiPolicy', () => ({
  findByOrgId: mockFindByOrgId,
  upsert:      mockPolicyUpsert,
}));
jest.mock('../src/models/AiReplyLog', () => ({
  create: mockReplyLogCreate,
  update: mockReplyLogUpdate,
}));
jest.mock('../src/models/Ticket', () => ({
  findById:    mockTicketFindById,
  getComments: mockTicketGetComments,
  addComment:  mockTicketAddComment,
}));
jest.mock('../src/models/TicketComment', () => ({
  create: mockTicketCommentCreate,
}));
jest.mock('../src/models/Notification', () => ({
  create: mockNotificationCreate,
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------
const mockTopologySummarize = jest.fn();
const mockHealthSnapshot    = jest.fn();
const mockGetPhrasesByCategory = jest.fn();
const mockGetTermsByLocale     = jest.fn();
const mockValidateDraft        = jest.fn();
const mockLlmChat              = jest.fn();

jest.mock('../src/services/topologyContextService', () => ({
  summarize: mockTopologySummarize,
}));
jest.mock('../src/services/serviceHealthService', () => ({
  getSnapshot: mockHealthSnapshot,
}));
jest.mock('../src/services/phraseLibraryService', () => ({
  getPhrasesByCategory: mockGetPhrasesByCategory,
  getTermsByLocale:     mockGetTermsByLocale,
  validateDraft:        mockValidateDraft,
}));
jest.mock('../src/services/llmProviderService', () => ({
  chat: mockLlmChat,
}));

// ---------------------------------------------------------------------------
// Load service AFTER mocks are in place
// ---------------------------------------------------------------------------
const svc = require('../src/services/aiReplyService');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const DEFAULT_POLICY = {
  enabled:              1,
  enabled_channels:     { portal: true, email: false, whatsapp: false, sms: false },
  mode:                 'draft_only',
  auto_send_confidence: '0.85',
  default_locale:       'es-MX',
  tone:                 'formal',
  redact_pii_before_llm: 1,
  active_provider_id:   42,
};

const DEFAULT_CLASSIFY_RESPONSE = {
  text: '{"category":"connectivity","priority":"medium","language":"es-MX","confidence":0.92}',
  json: { category: 'connectivity', priority: 'medium', language: 'es-MX', confidence: 0.92 },
  usage: { prompt_tokens: 20, completion_tokens: 10 },
  cost_usd: 0.00001,
};

const DEFAULT_REPLY_RESPONSE = {
  text: 'Estimado cliente, hemos revisado su caso y todo está funcionando correctamente.',
  json: null,
  usage: { prompt_tokens: 150, completion_tokens: 50 },
  cost_usd: 0.0001,
};

const DEFAULT_LOG_ENTRY = { id: 101 };

const DEFAULT_TICKET = { id: 1, organization_id: 1, assigned_to: 7, contract_id: 10 };

function setupDefaults() {
  mockFindByOrgId.mockResolvedValue({ ...DEFAULT_POLICY });
  mockTopologySummarize.mockResolvedValue({ cpe: null, accessDevice: null, backhauls: [], coreDevice: null, activeOutages: [] });
  mockHealthSnapshot.mockResolvedValue({ contractId: 1, radiusSession: null });
  mockGetPhrasesByCategory.mockResolvedValue({});
  mockGetTermsByLocale.mockResolvedValue([]);
  mockValidateDraft.mockResolvedValue({ valid: true, missingRequired: [], hitForbidden: [] });
  mockLlmChat
    .mockResolvedValueOnce(DEFAULT_CLASSIFY_RESPONSE) // classify
    .mockResolvedValueOnce(DEFAULT_REPLY_RESPONSE);    // generate
  mockReplyLogCreate.mockResolvedValue(DEFAULT_LOG_ENTRY);
  mockReplyLogUpdate.mockResolvedValue({ id: 101, action: 'auto_sent' });
  mockTicketFindById.mockResolvedValue(DEFAULT_TICKET);
  mockTicketGetComments.mockResolvedValue([]);
  mockTicketAddComment.mockResolvedValue({ id: 200 });
  mockTicketCommentCreate.mockResolvedValue({ id: 201 });
  mockNotificationCreate.mockResolvedValue({ id: 300 });
}

const GENERATE_ARGS = {
  orgId:        1,
  ticketId:     1,
  channel:      'portal',
  inboundText:  'Mi internet no funciona desde esta mañana.',
  contractId:   10,
};

afterEach(() => jest.clearAllMocks());

// =============================================================================
// _redactPii / _rehydratePii
// =============================================================================

describe('aiReplyService._redactPii', () => {
  it('redacts IPv4 addresses', () => {
    const { redacted, mapping } = svc._redactPii('IP is 192.168.1.1 ok');
    expect(redacted).not.toContain('192.168.1.1');
    expect(mapping.size).toBeGreaterThanOrEqual(1);
  });

  it('redacts email addresses', () => {
    const { redacted, mapping } = svc._redactPii('Contact user@example.com please');
    expect(redacted).not.toContain('user@example.com');
    expect(mapping.size).toBe(1);
  });

  it('redacts MAC addresses', () => {
    const { redacted, mapping } = svc._redactPii('MAC: AA:BB:CC:DD:EE:FF here');
    expect(redacted).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(mapping.size).toBeGreaterThanOrEqual(1);
  });

  it('returns empty mapping when no PII found', () => {
    const { redacted, mapping } = svc._redactPii('Hello, how are you?');
    expect(redacted).toBe('Hello, how are you?');
    expect(mapping.size).toBe(0);
  });
});

describe('aiReplyService._rehydratePii', () => {
  it('restores redacted tokens to original values', () => {
    const { redacted, mapping } = svc._redactPii('IP is 10.0.0.1 and email user@test.com');
    const restored = svc._rehydratePii(redacted, mapping);
    expect(restored).toContain('10.0.0.1');
    expect(restored).toContain('user@test.com');
  });

  it('round-trips correctly when no PII present', () => {
    const mapping = new Map();
    expect(svc._rehydratePii('hello world', mapping)).toBe('hello world');
  });
});

// =============================================================================
// _validateOutput
// =============================================================================

describe('aiReplyService._validateOutput', () => {
  const okValidation = { valid: true, missingRequired: [], hitForbidden: [] };

  it('returns valid for clean output', () => {
    const r = svc._validateOutput('A normal reply', { phraseValidation: okValidation });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails on missing required phrase', () => {
    const r = svc._validateOutput('Some reply', {
      phraseValidation: { valid: false, missingRequired: ['gracias por contactarnos'], hitForbidden: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('gracias por contactarnos'))).toBe(true);
  });

  it('fails on forbidden term', () => {
    const r = svc._validateOutput('We are unable to help you', {
      phraseValidation: { valid: false, missingRequired: [], hitForbidden: [{ term: 'unable', replacement: null }] },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('unable'))).toBe(true);
  });

  it('fails on empty response', () => {
    const r = svc._validateOutput('   ', { phraseValidation: okValidation });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/empty/i);
  });

  it('fails when response exceeds 2000 chars', () => {
    const r = svc._validateOutput('x'.repeat(2001), { phraseValidation: okValidation });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/too long/i);
  });

  it('fails when URL is present and no allowlist configured', () => {
    const r = svc._validateOutput('Visit https://external.com for details', { phraseValidation: okValidation });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('https://external.com'))).toBe(true);
  });

  it('passes when URL is in the allowlist', () => {
    const r = svc._validateOutput('Visit https://myisp.com for info', {
      phraseValidation: okValidation,
      allowedUrlDomains: ['myisp.com'],
    });
    expect(r.valid).toBe(true);
  });
});

// =============================================================================
// _renderSystemPrompt
// =============================================================================

describe('aiReplyService._renderSystemPrompt', () => {
  it('includes tone in system prompt', () => {
    const prompt = svc._renderSystemPrompt({
      tone: 'friendly', category: 'general',
      phrasesByCategory: {}, forbiddenTerms: [],
      contextJson: '{}', ticketHistory: [],
    });
    expect(prompt).toContain('friendly');
  });

  it('includes required phrases', () => {
    const prompt = svc._renderSystemPrompt({
      tone: 'formal', category: 'connectivity',
      phrasesByCategory: { connectivity: [{ text: 'Gracias por contactarnos', is_required: 1 }] },
      forbiddenTerms: [],
      contextJson: '{}', ticketHistory: [],
    });
    expect(prompt).toContain('Gracias por contactarnos');
  });

  it('includes forbidden terms', () => {
    const prompt = svc._renderSystemPrompt({
      tone: 'formal', category: 'general',
      phrasesByCategory: {},
      forbiddenTerms: [{ term: 'impossible', replacement: null }],
      contextJson: '{}', ticketHistory: [],
    });
    expect(prompt).toContain('impossible');
  });

  it('includes ticket history', () => {
    const history = [{ created_at: '2026-04-29T10:00:00Z', is_internal: false, body: 'My internet is slow' }];
    const prompt = svc._renderSystemPrompt({
      tone: 'formal', category: 'general',
      phrasesByCategory: {}, forbiddenTerms: [],
      contextJson: '{}', ticketHistory: history,
    });
    expect(prompt).toContain('My internet is slow');
  });
});

// =============================================================================
// generate() — Gate
// =============================================================================

describe('aiReplyService.generate — gate', () => {
  it('returns skipped when policy.enabled=0', async () => {
    mockFindByOrgId.mockResolvedValue({ ...DEFAULT_POLICY, enabled: 0 });
    const r = await svc.generate(GENERATE_ARGS);
    expect(r).toEqual({ skipped: true, reason: 'policy_disabled' });
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('returns skipped when channel is disabled', async () => {
    mockFindByOrgId.mockResolvedValue({
      ...DEFAULT_POLICY,
      enabled_channels: { portal: false, email: false },
    });
    const r = await svc.generate(GENERATE_ARGS);
    expect(r).toEqual({ skipped: true, reason: 'channel_disabled' });
  });

  it('returns skipped when no active provider is configured', async () => {
    mockFindByOrgId.mockResolvedValue({ ...DEFAULT_POLICY, active_provider_id: null });
    const r = await svc.generate(GENERATE_ARGS);
    expect(r).toEqual({ skipped: true, reason: 'no_active_provider' });
  });

  it('handles JSON-string enabled_channels', async () => {
    mockFindByOrgId.mockResolvedValue({
      ...DEFAULT_POLICY,
      enabled_channels: JSON.stringify({ portal: true }),
    });
    setupDefaults();
    mockFindByOrgId.mockResolvedValue({
      ...DEFAULT_POLICY,
      enabled_channels: JSON.stringify({ portal: true }),
    });
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.skipped).toBe(false);
  });
});

// =============================================================================
// generate() — draft_only mode (happy path)
// =============================================================================

describe('aiReplyService.generate — draft_only', () => {
  beforeEach(() => setupDefaults());

  it('returns logId, draftText, and action=proposed', async () => {
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.skipped).toBe(false);
    expect(r.logId).toBe(101);
    expect(typeof r.draftText).toBe('string');
    expect(r.action).toBe('proposed');
  });

  it('attaches an internal comment to the ticket', async () => {
    await svc.generate(GENERATE_ARGS);
    expect(mockTicketAddComment).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 1, is_internal: true }),
    );
  });

  it('persists AiReplyLog with correct fields', async () => {
    await svc.generate(GENERATE_ARGS);
    const logCall = mockReplyLogCreate.mock.calls[0][0];
    expect(logCall.organization_id).toBe(1);
    expect(logCall.ticket_id).toBe(1);
    expect(logCall.provider_id).toBe(42);
    expect(logCall.action).toBe('proposed');
    expect(typeof logCall.prompt_hash).toBe('string');
    expect(logCall.prompt_hash).toHaveLength(64); // SHA-256 hex
  });

  it('does not persist PII in context_snapshot', async () => {
    mockTopologySummarize.mockResolvedValue({ cpe: { ip: '10.0.0.1', name: 'CPE' } });
    await svc.generate(GENERATE_ARGS);
    const logCall = mockReplyLogCreate.mock.calls[0][0];
    expect(logCall.context_snapshot).not.toContain('10.0.0.1');
  });

  it('rehydrates PII in the returned draftText', async () => {
    const ipInMessage = 'My IP is 192.168.0.5 please check';
    mockLlmChat.mockReset();
    mockLlmChat
      .mockResolvedValueOnce(DEFAULT_CLASSIFY_RESPONSE) // classify
      .mockResolvedValueOnce({                           // generate — echo the IP placeholder back
        ...DEFAULT_REPLY_RESPONSE,
        text: 'Reply about [IP_1] received.',
      });
    const r = await svc.generate({ ...GENERATE_ARGS, inboundText: ipInMessage });
    expect(r.draftText).toContain('192.168.0.5');
  });

  it('calls topologyContextService.summarize when contractId is set', async () => {
    await svc.generate(GENERATE_ARGS);
    expect(mockTopologySummarize).toHaveBeenCalledWith(10);
  });

  it('skips topology/health when contractId is null', async () => {
    await svc.generate({ ...GENERATE_ARGS, contractId: null });
    expect(mockTopologySummarize).not.toHaveBeenCalled();
    expect(mockHealthSnapshot).not.toHaveBeenCalled();
  });
});

// =============================================================================
// generate() — suggest mode
// =============================================================================

describe('aiReplyService.generate — suggest mode', () => {
  beforeEach(() => {
    setupDefaults();
    mockFindByOrgId.mockResolvedValue({ ...DEFAULT_POLICY, mode: 'suggest' });
  });

  it('attaches internal comment and notifies assigned agent', async () => {
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.action).toBe('proposed');
    expect(mockTicketAddComment).toHaveBeenCalled();
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, type: 'ai_reply_suggested' }),
    );
  });

  it('does not notify when no assigned agent', async () => {
    mockTicketFindById.mockResolvedValue({ ...DEFAULT_TICKET, assigned_to: null });
    await svc.generate(GENERATE_ARGS);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// generate() — auto_send mode
// =============================================================================

describe('aiReplyService.generate — auto_send mode (above threshold)', () => {
  beforeEach(() => {
    setupDefaults();
    mockFindByOrgId.mockResolvedValue({
      ...DEFAULT_POLICY,
      mode: 'auto_send',
      auto_send_confidence: '0.85',
    });
    // classify returns confidence 0.92 (above 0.85)
  });

  it('creates a public TicketComment and updates log to auto_sent', async () => {
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.action).toBe('auto_sent');
    expect(mockTicketCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 1, is_internal: false }),
    );
    expect(mockReplyLogUpdate).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ action: 'auto_sent' }),
    );
  });

  it('does NOT call addComment (uses TicketComment.create instead)', async () => {
    await svc.generate(GENERATE_ARGS);
    expect(mockTicketAddComment).not.toHaveBeenCalled();
  });
});

describe('aiReplyService.generate — auto_send mode (below threshold)', () => {
  beforeEach(() => {
    setupDefaults();
    mockFindByOrgId.mockResolvedValue({
      ...DEFAULT_POLICY,
      mode: 'auto_send',
      auto_send_confidence: '0.95',
    });
    // classify returns confidence 0.92 (BELOW 0.95)
  });

  it('falls back to suggest when confidence is below threshold', async () => {
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.action).toBe('proposed');
    expect(mockTicketCommentCreate).not.toHaveBeenCalled();
    expect(mockTicketAddComment).toHaveBeenCalledWith(
      expect.objectContaining({ is_internal: true }),
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });
});

// =============================================================================
// generate() — LLM failure
// =============================================================================

describe('aiReplyService.generate — LLM failure', () => {
  beforeEach(() => {
    setupDefaults();
    // Reset LLM mock so queued responses from setupDefaults don't interfere
    mockLlmChat.mockReset();
    // First call = classify (succeeds), second call = generate (fails)
    mockLlmChat
      .mockResolvedValueOnce(DEFAULT_CLASSIFY_RESPONSE)
      .mockRejectedValue(new Error('Network timeout'));
  });

  it('returns action=failed when LLM call throws', async () => {
    const r = await svc.generate(GENERATE_ARGS);
    expect(r.skipped).toBe(false);
    expect(r.action).toBe('failed');
    expect(r.draftText).toBeNull();
  });

  it('persists a failed log entry with error text', async () => {
    await svc.generate(GENERATE_ARGS);
    const logCall = mockReplyLogCreate.mock.calls[0][0];
    expect(logCall.action).toBe('failed');
    expect(logCall.error).toContain('Network timeout');
  });
});

// =============================================================================
// generate() — Output validation retry
// =============================================================================

describe('aiReplyService.generate — validation retry', () => {
  it('retries up to 2 times when output fails validation, then succeeds', async () => {
    setupDefaults();
    mockLlmChat.mockReset();
    const badReply  = { ...DEFAULT_REPLY_RESPONSE, text: 'Bad reply with forbidden term' };
    const goodReply = { ...DEFAULT_REPLY_RESPONSE, text: 'Good clean reply for the customer.' };

    mockLlmChat
      .mockResolvedValueOnce(DEFAULT_CLASSIFY_RESPONSE)  // classify
      .mockResolvedValueOnce(badReply)                   // attempt 1 — fails
      .mockResolvedValueOnce(goodReply);                 // attempt 2 — passes

    // First validateDraft call (attempt 1) returns forbidden term hit; second is clean
    mockValidateDraft
      .mockResolvedValueOnce({ valid: false, missingRequired: [], hitForbidden: [{ term: 'forbidden', replacement: null }] })
      .mockResolvedValueOnce({ valid: true, missingRequired: [], hitForbidden: [] });

    const r = await svc.generate(GENERATE_ARGS);
    expect(r.action).toBe('proposed');
    expect(r.draftText).toContain('Good clean reply');
    // LLM called: 1 classify + 2 generate attempts
    expect(mockLlmChat).toHaveBeenCalledTimes(3);
  });

  it('returns failed after 3 unsuccessful attempts', async () => {
    setupDefaults();
    const badReply = { ...DEFAULT_REPLY_RESPONSE, text: 'Still bad' };

    mockLlmChat
      .mockResolvedValueOnce(DEFAULT_CLASSIFY_RESPONSE)
      .mockResolvedValue(badReply); // all generate attempts return bad reply

    mockValidateDraft.mockResolvedValue({
      valid: false, missingRequired: ['required phrase'], hitForbidden: [],
    });

    const r = await svc.generate(GENERATE_ARGS);
    expect(r.action).toBe('failed');
    // 1 classify + 3 generate attempts
    expect(mockLlmChat).toHaveBeenCalledTimes(4);
  });
});

// =============================================================================
// generate() — PII redaction off
// =============================================================================

describe('aiReplyService.generate — PII redaction disabled', () => {
  it('does not redact when redact_pii_before_llm=0', async () => {
    setupDefaults();
    mockFindByOrgId.mockResolvedValue({ ...DEFAULT_POLICY, redact_pii_before_llm: 0 });
    mockTopologySummarize.mockResolvedValue({ cpe: { ip: '10.0.0.99' } });

    await svc.generate(GENERATE_ARGS);
    const logCall = mockReplyLogCreate.mock.calls[0][0];
    // context_snapshot should contain the raw IP
    expect(logCall.context_snapshot).toContain('10.0.0.99');
  });
});

// =============================================================================
// generate() — classify fallback
// =============================================================================

describe('aiReplyService.generate — classify fallback', () => {
  it('uses safe defaults when classification LLM call throws', async () => {
    setupDefaults();
    mockLlmChat.mockReset();
    mockLlmChat
      .mockRejectedValueOnce(new Error('classify failed'))  // classify throws
      .mockResolvedValueOnce(DEFAULT_REPLY_RESPONSE);       // generate succeeds

    const r = await svc.generate(GENERATE_ARGS);
    // Pipeline should continue with default classification
    expect(r.skipped).toBe(false);
    const logCall = mockReplyLogCreate.mock.calls[0][0];
    expect(logCall.classification).toBe('general'); // default category
    expect(logCall.confidence).toBe(0.5);           // default confidence
  });
});
