// =============================================================================
// FireISP 5.0 — §4 AI Background Workers Tests
// =============================================================================
// Covers all three AI BullMQ workers registered in src/workers/index.js:
//   • ai-triage              (aiTriageWorker)
//   • ai-backfill-embeddings (aiBackfillEmbeddingsWorker)
//   • ai-cost-rollup         (aiCostRollupWorker)
//
// All external I/O is mocked; no Redis or DB required.
// =============================================================================

jest.mock('../../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../src/config/database', () => ({ query: mockDbQuery }));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeJob(data = {}) {
  return { id: `test-${Date.now()}`, data };
}

// ---------------------------------------------------------------------------
// Extract registered handler for a named queue
// ---------------------------------------------------------------------------
function getHandler(jobQueue, name) {
  const call = jobQueue.process.mock.calls.find(([n]) => n === name);
  if (!call) throw new Error(`No handler registered for queue "${name}"`);
  return call[1];
}

// =============================================================================
// 1. ai-triage worker
// =============================================================================

describe('aiTriageWorker (ai-triage)', () => {
  const mockGenerate = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGenerate.mockReset();
    jest.mock('../../src/services/aiReplyService', () => ({ generate: mockGenerate }));
    jest.mock('../../src/services/jobQueueService', () => ({
      add:      jest.fn().mockResolvedValue({ id: 'x' }),
      process:  jest.fn(),
      close:    jest.fn(),
      getStats: jest.fn(),
      QUEUE_NAMES: [],
    }));
  });

  it('delegates to aiReplyService.generate with all job data fields', async () => {
    mockGenerate.mockResolvedValue({ skipped: false, logId: 1, action: 'proposed' });

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-triage');
    const result = await handler(makeJob({
      orgId: 1, ticketId: 10, channel: 'portal', inboundText: 'Internet down', contractId: 5,
    }));

    expect(mockGenerate).toHaveBeenCalledWith({
      orgId: 1, ticketId: 10, channel: 'portal', inboundText: 'Internet down', contractId: 5,
    });
    expect(result).toMatchObject({ logId: 1, action: 'proposed' });
  });

  it('returns { skipped: true } when policy is disabled', async () => {
    mockGenerate.mockResolvedValue({ skipped: true, reason: 'policy_disabled' });

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-triage');
    const result = await handler(makeJob({ orgId: 2, ticketId: 3, channel: 'portal', inboundText: 'x' }));

    expect(result).toEqual({ skipped: true, reason: 'policy_disabled' });
  });

  it('returns { skipped: true } when channel is not enabled', async () => {
    mockGenerate.mockResolvedValue({ skipped: true, reason: 'channel_disabled' });

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-triage');
    const result = await handler(makeJob({ orgId: 1, ticketId: 5, channel: 'sms', inboundText: 'x' }));

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('channel_disabled');
  });
});

// =============================================================================
// 2. ai-backfill-embeddings worker
// =============================================================================

describe('aiBackfillEmbeddingsWorker (ai-backfill-embeddings)', () => {
  const mockListPhrases = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockListPhrases.mockReset();
    jest.mock('../../src/services/phraseLibraryService', () => ({ listPhrases: mockListPhrases }));
    jest.mock('../../src/services/jobQueueService', () => ({
      add:      jest.fn().mockResolvedValue({ id: 'x' }),
      process:  jest.fn(),
      close:    jest.fn(),
      getStats: jest.fn(),
      QUEUE_NAMES: [],
    }));
  });

  afterEach(() => {
    delete process.env.VECTOR_RETRIEVAL_ENABLED;
  });

  it('skips backfill when VECTOR_RETRIEVAL_ENABLED is not set', async () => {
    delete process.env.VECTOR_RETRIEVAL_ENABLED;

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-backfill-embeddings');
    const result  = await handler(makeJob({ orgId: 1 }));

    expect(result).toEqual({ skipped: true, reason: 'vector_retrieval_disabled' });
    expect(mockListPhrases).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('skips backfill when VECTOR_RETRIEVAL_ENABLED=false', async () => {
    process.env.VECTOR_RETRIEVAL_ENABLED = 'false';

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-backfill-embeddings');
    const result  = await handler(makeJob({ orgId: 1 }));

    expect(result).toEqual({ skipped: true, reason: 'vector_retrieval_disabled' });
  });

  it('runs backfill when VECTOR_RETRIEVAL_ENABLED=true', async () => {
    process.env.VECTOR_RETRIEVAL_ENABLED = 'true';

    mockListPhrases.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], total: 2 });
    mockDbQuery.mockResolvedValue([[
      { id: 10, subject: 'Ticket 1', description: 'Resolved ok' },
      { id: 11, subject: 'Ticket 2', description: 'Also resolved' },
    ]]);

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-backfill-embeddings');
    const result  = await handler(makeJob({ orgId: 1 }));

    expect(result.skipped).toBe(false);
    expect(result.orgId).toBe(1);
    expect(result.phrasesIndexed).toBe(2);
    expect(result.ticketsIndexed).toBe(2);
    expect(mockListPhrases).toHaveBeenCalledWith(1, { limit: 1000 });
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('status = \'resolved\''),
      [1],
    );
  });

  it('handles org with no phrases or resolved tickets gracefully', async () => {
    process.env.VECTOR_RETRIEVAL_ENABLED = 'true';

    mockListPhrases.mockResolvedValue({ data: [], total: 0 });
    mockDbQuery.mockResolvedValue([[]]); // no resolved tickets

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-backfill-embeddings');
    const result  = await handler(makeJob({ orgId: 99 }));

    expect(result.skipped).toBe(false);
    expect(result.phrasesIndexed).toBe(0);
    expect(result.ticketsIndexed).toBe(0);
  });
});

// =============================================================================
// 3. ai-cost-rollup worker
// =============================================================================

describe('aiCostRollupWorker (ai-cost-rollup)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    jest.mock('../../src/services/jobQueueService', () => ({
      add:      jest.fn().mockResolvedValue({ id: 'x' }),
      process:  jest.fn(),
      close:    jest.fn(),
      getStats: jest.fn(),
      QUEUE_NAMES: [],
    }));
  });

  it('returns { updated: 0 } when no logs exist for the current month', async () => {
    mockDbQuery.mockResolvedValueOnce([[]]); // empty aggregate SELECT

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-cost-rollup');
    const result  = await handler(makeJob({ organizationId: null }));

    const now = new Date();
    const expectedMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    expect(result.updated).toBe(0);
    expect(result.month).toBe(expectedMonth);
    // Only the SELECT was called, no upsert
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('upserts one row per org into organization_quotas', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[
        { organization_id: 1, total_cost_usd: 0.003400 },
        { organization_id: 2, total_cost_usd: 0.001200 },
      ]])
      .mockResolvedValue([{ affectedRows: 1 }]); // for each upsert

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-cost-rollup');
    const result  = await handler(makeJob({ organizationId: null }));

    expect(result.updated).toBe(2);
    // SELECT + 2 upserts = 3 total DB calls
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
    // Verify the upsert SQL includes ai_cost_month_usd and ON DUPLICATE KEY
    const upsertCall = mockDbQuery.mock.calls[1];
    expect(upsertCall[0]).toContain('ai_cost_month_usd');
    expect(upsertCall[0]).toContain('ON DUPLICATE KEY UPDATE');
    // Params: [org_id, total_cost_usd, currentMonth] — simple overwrite, no IF logic
    expect(upsertCall[1]).toHaveLength(3);
    expect(upsertCall[1][1]).toBeCloseTo(0.003400, 5);
  });

  it('scopes the SELECT to a single org when organizationId is provided', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[{ organization_id: 5, total_cost_usd: 0.0005 }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-cost-rollup');
    await handler(makeJob({ organizationId: 5 }));

    const selectCall = mockDbQuery.mock.calls[0];
    // Params should include the org ID
    expect(selectCall[1]).toContain(5);
  });

  it('resets cost to zero at month boundary (overwrites with new month aggregate)', async () => {
    // Since total_cost_usd is a full month aggregate from the SELECT, a simple
    // overwrite correctly handles month-boundary reset: the new month's total
    // replaces the old month's total without double-counting.
    const newMonthCost = 0.0010;
    mockDbQuery
      .mockResolvedValueOnce([[{ organization_id: 3, total_cost_usd: newMonthCost }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    const jobQueue = require('../../src/services/jobQueueService');
    const workers  = require('../../src/workers');
    workers.registerWorkers();

    const handler = getHandler(jobQueue, 'ai-cost-rollup');
    const result  = await handler(makeJob({ organizationId: null }));

    // Verify the upsert uses VALUES() overwrite — no IF/addition logic
    const upsertSql = mockDbQuery.mock.calls[1][0];
    expect(upsertSql).toContain('VALUES(ai_cost_month_usd)');
    expect(upsertSql).toContain('VALUES(ai_cost_rollup_month)');

    // Params are simple: [org_id, cost, month]
    const upsertParams = mockDbQuery.mock.calls[1][1];
    expect(upsertParams).toHaveLength(3);
    expect(upsertParams[1]).toBeCloseTo(newMonthCost, 6);
    expect(result.updated).toBe(1);
  });
});

// =============================================================================
// 4. QUEUE_NAMES includes all AI queue names
// =============================================================================

describe('QUEUE_NAMES — AI queues registered', () => {
  it('contains ai-triage, ai-backfill-embeddings, and ai-cost-rollup', () => {
    const { QUEUE_NAMES } = jest.requireActual('../../src/services/jobQueueService');
    expect(QUEUE_NAMES).toContain('ai-triage');
    expect(QUEUE_NAMES).toContain('ai-backfill-embeddings');
    expect(QUEUE_NAMES).toContain('ai-cost-rollup');
  });
});
