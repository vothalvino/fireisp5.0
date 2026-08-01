'use strict';
// =============================================================================
// FireISP 5.0 — aiReplyService.generate() proves ownership of BOTH ids
// =============================================================================
// #601 added a contract_id ownership probe to src/routes/ai.js. That was the
// wrong PLACE, and it also guarded only one of the two ids in the very request
// body it was hardening. Four entry points converge on generate():
//
//   src/routes/ai.js        POST /ai/reply/draft      — body-supplied, guarded
//   src/graphql/resolvers.js aiDraftReply mutation    — body-supplied, UNGUARDED
//   src/routes/tickets.js   POST /tickets -> ai-triage worker — UNGUARDED
//   src/routes/portal.js    portal chat               — derives its own ids
//
// What the unguarded ids reach:
//
//   ticketId  -> Ticket.getComments() is `SELECT * FROM ticket_comments WHERE
//                ticket_id = ?` with no org predicate, and those rows —
//                including agent-only notes labelled "(internal)" — are
//                rendered into an LLM prompt whose inbound text the caller
//                controls. Then Step 10 WRITES: Ticket.addComment() is an
//                unscoped INSERT and the `Ticket.findById(ticketId, orgId)`
//                above it is never null-checked, so a foreign ticket receives a
//                comment — customer-visible when mode='auto_send'.
//   contractId -> serviceHealthService.getSnapshot() and
//                topologyContextService.summarize() key on contract_id and
//                device_id with no org predicate.
//
// These tests assert on the SERVICE, not the routes, because that is where the
// fix has to live for all four callers. A route-level test would have passed
// throughout the window in which three of the four were exploitable.
// =============================================================================

const mockFindByOrgId = jest.fn();
const mockTicketFindById = jest.fn();
const mockTicketGetComments = jest.fn();
const mockTicketAddComment = jest.fn();

jest.mock('../src/models/AiPolicy', () => ({ findByOrgId: mockFindByOrgId, upsert: jest.fn() }));
const mockLogCreate = jest.fn();
jest.mock('../src/models/AiReplyLog', () => ({ create: mockLogCreate, update: jest.fn() }));
jest.mock('../src/models/Ticket', () => ({
  findById: mockTicketFindById,
  getComments: mockTicketGetComments,
  addComment: mockTicketAddComment,
}));
jest.mock('../src/models/TicketComment', () => ({ create: jest.fn() }));
jest.mock('../src/models/Notification', () => ({ create: jest.fn() }));

const mockTopologySummarize = jest.fn();
const mockHealthSnapshot = jest.fn();
jest.mock('../src/services/topologyContextService', () => ({ summarize: mockTopologySummarize }));
jest.mock('../src/services/serviceHealthService', () => ({ getSnapshot: mockHealthSnapshot }));
const mockPhrases = jest.fn();
const mockTerms = jest.fn();
const mockValidateDraft = jest.fn();
const mockPhraseSearch = jest.fn();
jest.mock('../src/services/phraseLibraryService', () => ({
  getPhrasesByCategory: mockPhrases, getTermsByLocale: mockTerms,
  validateDraft: mockValidateDraft, search: mockPhraseSearch,
}));
const mockLlmChat = jest.fn();
jest.mock('../src/services/llmProviderService', () => ({ chat: mockLlmChat }));

const mockDbQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query: (...a) => mockDbQuery(...a), execute: (...a) => mockDbQuery(...a),
}));

const svc = require('../src/services/aiReplyService');

const ORG = 1;
const ARGS = { orgId: ORG, ticketId: 6, inboundText: 'sin servicio' };

/** owns: which ids the acting org actually owns. */
function wire({ ownsTicket = true, ownsContract = true } = {}) {
  mockDbQuery.mockImplementation(async (sql) => {
    if (/FROM tickets WHERE id = \? AND organization_id = \?/.test(sql)) {
      return [ownsTicket ? [{ id: 6 }] : []];
    }
    if (/FROM contracts WHERE id = \? AND organization_id = \?/.test(sql)) {
      return [ownsContract ? [{ id: 22 }] : []];
    }
    return [[]];
  });
  // A policy that is fully ENABLED — otherwise the gate would mask the guard and
  // these tests would pass for the wrong reason.
  // Downstream fixture — shapes copied from tests/aiReplyService.test.js so the
  // happy path completes and the "unaffected" cases test the guard, not my mocks.
  mockPhrases.mockResolvedValue({});
  mockTerms.mockResolvedValue([]);
  mockValidateDraft.mockResolvedValue({ valid: true, missingRequired: [], hitForbidden: [] });
  mockPhraseSearch.mockResolvedValue([]);
  mockLogCreate.mockResolvedValue({ id: 101 });
  mockTicketGetComments.mockResolvedValue([]);
  mockTicketAddComment.mockResolvedValue({ id: 200 });
  mockTicketFindById.mockResolvedValue({ id: 6, organization_id: ORG });
  mockTopologySummarize.mockResolvedValue({});
  mockHealthSnapshot.mockResolvedValue({});
  mockLlmChat.mockResolvedValue({
    text: '{"category":"connectivity","priority":"medium","language":"es-MX","confidence":0.9}',
    json: { category: 'connectivity', priority: 'medium', language: 'es-MX', confidence: 0.9 },
    usage: {}, cost_usd: 0,
  });
  mockFindByOrgId.mockResolvedValue({
    enabled: 1,
    enabled_channels: { portal: true },
    mode: 'draft_only',
    active_provider_id: 42,
    default_locale: 'es-MX',
    tone: 'formal',
    redact_pii_before_llm: 1,
    auto_send_confidence: '0.85',
  });
}

beforeEach(() => jest.clearAllMocks());

describe('a foreign ticket is refused', () => {
  it('returns skipped rather than reading it', async () => {
    wire({ ownsTicket: false });
    const res = await svc.generate(ARGS);
    expect(res).toEqual({ skipped: true, reason: 'ticket_not_in_org' });
  });

  it('never reads the other tenant\'s comments', async () => {
    // The read half: those comments go into an LLM prompt whose inbound text the
    // attacker controls, so reading them at all is the disclosure.
    wire({ ownsTicket: false });
    await svc.generate(ARGS);
    expect(mockTicketGetComments).not.toHaveBeenCalled();
  });

  it('never writes a comment onto it', async () => {
    // The write half, and the worse one: under mode='auto_send' this comment is
    // CUSTOMER-VISIBLE on another tenant's ticket.
    wire({ ownsTicket: false });
    await svc.generate(ARGS);
    expect(mockTicketAddComment).not.toHaveBeenCalled();
  });

  it('does not reach the LLM at all — no cost, no provider call', async () => {
    wire({ ownsTicket: false });
    await svc.generate(ARGS);
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('refuses BEFORE the policy gate, so it applies even to a fully enabled org', async () => {
    // Ordering matters: if the ownership check sat after the gate, an install
    // with AI switched on — the only kind where this is reachable — would be
    // exactly the one it failed to protect.
    wire({ ownsTicket: false });
    const res = await svc.generate(ARGS);
    expect(res.reason).toBe('ticket_not_in_org');
  });
});

describe('a foreign contract is refused', () => {
  it('returns skipped', async () => {
    wire({ ownsContract: false });
    const res = await svc.generate({ ...ARGS, contractId: 22 });
    expect(res).toEqual({ skipped: true, reason: 'contract_not_in_org' });
  });

  it('never snapshots the other tenant\'s service health or topology', async () => {
    wire({ ownsContract: false });
    await svc.generate({ ...ARGS, contractId: 22 });
    expect(mockHealthSnapshot).not.toHaveBeenCalled();
    expect(mockTopologySummarize).not.toHaveBeenCalled();
  });

  it('guards it in the SERVICE, so the GraphQL and worker callers are covered', async () => {
    // src/routes/ai.js has its own probe; the GraphQL aiDraftReply mutation and
    // the ai-triage worker do not. Asserting here is what covers them.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/services/aiReplyService.js'), 'utf8',
    );
    const step0 = src.slice(src.indexOf('Step 0: Ownership'), src.indexOf('Step 1: Gate'));
    expect(step0).toMatch(/FROM tickets WHERE id = \? AND organization_id = \?/);
    expect(step0).toMatch(/FROM contracts WHERE id = \? AND organization_id = \?/);
  });
});

describe('legitimate use is unaffected', () => {
  it('proceeds when both ids belong to the org', async () => {
    wire();
    mockTicketGetComments.mockResolvedValue([]);
    mockTicketFindById.mockResolvedValue({ id: 6, organization_id: ORG });
    mockLlmChat.mockResolvedValue({
      text: '{"category":"connectivity","priority":"medium","language":"es-MX","confidence":0.9}',
      json: { category: 'connectivity', priority: 'medium', language: 'es-MX', confidence: 0.9 },
      usage: {}, cost_usd: 0,
    });
    mockTopologySummarize.mockResolvedValue({});
    mockHealthSnapshot.mockResolvedValue({});
    const res = await svc.generate({ ...ARGS, contractId: 22 });
    expect(res.skipped === true && /not_in_org/.test(res.reason || '')).toBe(false);
  });

  it('omitting contractId skips only the contract probe', async () => {
    // contract_id is optional; a draft with no contract must not start refusing.
    wire();
    mockTicketGetComments.mockResolvedValue([]);
    mockLlmChat.mockResolvedValue({ text: '{}', json: {}, usage: {}, cost_usd: 0 });
    const res = await svc.generate(ARGS);
    expect(res.reason).not.toBe('contract_not_in_org');
    expect(mockDbQuery.mock.calls.some(([s]) => /FROM contracts WHERE id = \?/.test(s))).toBe(false);
  });

  it('a null ticketId is not treated as id 0', async () => {
    // The portal chat passes a freshly-created ticket id; a caller passing null
    // must not probe for a ticket that cannot exist and get refused.
    wire();
    mockTicketGetComments.mockResolvedValue([]);
    mockLlmChat.mockResolvedValue({ text: '{}', json: {}, usage: {}, cost_usd: 0 });
    const res = await svc.generate({ orgId: ORG, ticketId: null, inboundText: 'x' });
    expect(res.reason).not.toBe('ticket_not_in_org');
  });
});
