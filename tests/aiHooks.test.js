// =============================================================================
// FireISP 5.0 — §3.6 AI Hooks Tests
// =============================================================================
// Tests cover:
//   1. aiTriage worker handler — delegates to aiReplyService.generate
//   2. Topology invalidation hooks — NetworkLink / Device / Contract routes
//      call topologyContextService.invalidate after save/delete/restore
//   3. Ticket create + new client TicketComment enqueue ai-triage jobs
// =============================================================================

// ---------------------------------------------------------------------------
// Shared logger mock
// ---------------------------------------------------------------------------
jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------
const mockDbQuery = jest.fn();
jest.mock('../src/config/database', () => ({ query: mockDbQuery }));

// =============================================================================
// 1. aiTriage worker
// =============================================================================

describe('workers/index.js — ai-triage handler', () => {
  const mockGenerate = jest.fn();
  jest.mock('../src/services/aiReplyService', () => ({ generate: mockGenerate }));
  jest.mock('../src/services/jobQueueService', () => ({
    add:     jest.fn().mockResolvedValue({ id: '1', status: 'queued' }),
    process: jest.fn(),
    close:   jest.fn(),
    getStats: jest.fn().mockResolvedValue({ mode: 'in-process', queues: [] }),
    QUEUE_NAMES: ['scheduled-task', 'webhook-delivery', 'sms-send', 'cfdi-stamp', 'config-backup', 'ai-triage'],
  }));

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('calls aiReplyService.generate with job data', async () => {
    // Re-require after resetModules so mocks apply cleanly
    const aiReplyService = require('../src/services/aiReplyService');
    aiReplyService.generate.mockResolvedValue({ skipped: false, logId: 1, action: 'proposed' });

    const jobQueue = require('../src/services/jobQueueService');
    const workers  = require('../src/workers');

    workers.registerWorkers();

    // Extract the registered handler for 'ai-triage'
    const processCall = jobQueue.process.mock.calls.find(([name]) => name === 'ai-triage');
    expect(processCall).toBeDefined();
    const handler = processCall[1];

    const job = {
      data: {
        orgId:       1,
        ticketId:    10,
        channel:     'portal',
        inboundText: 'My internet is down',
        contractId:  5,
      },
    };
    const result = await handler(job);

    expect(aiReplyService.generate).toHaveBeenCalledWith({
      orgId:       1,
      ticketId:    10,
      channel:     'portal',
      inboundText: 'My internet is down',
      contractId:  5,
    });
    expect(result).toMatchObject({ logId: 1, action: 'proposed' });
  });

  it('returns {skipped:true} when policy is disabled', async () => {
    const aiReplyService = require('../src/services/aiReplyService');
    aiReplyService.generate.mockResolvedValue({ skipped: true, reason: 'policy_disabled' });

    const jobQueue = require('../src/services/jobQueueService');
    const workers  = require('../src/workers');
    workers.registerWorkers();

    const processCall = jobQueue.process.mock.calls.find(([name]) => name === 'ai-triage');
    const result = await processCall[1]({ data: { orgId: 1, ticketId: 2, channel: 'portal', inboundText: 'x' } });
    expect(result).toEqual({ skipped: true, reason: 'policy_disabled' });
  });
});

// =============================================================================
// 2. Topology invalidation hooks — tested via direct mock assertions
// =============================================================================

describe('Topology invalidation hooks', () => {
  // Mock topologyContextService before any require
  const mockInvalidate = jest.fn().mockResolvedValue(undefined);
  jest.mock('../src/services/topologyContextService', () => ({
    invalidate: mockInvalidate,
    summarize:  jest.fn(),
    buildPath:  jest.fn(),
    getPath:    jest.fn(),
  }));

  // Mock all express middleware / dependent modules used by routes
  jest.mock('../src/middleware/auth',      () => ({ authenticate: (_r, _s, n) => n() }));
  jest.mock('../src/middleware/orgScope',  () => ({ orgScope:     (_r, _s, n) => n() }));
  jest.mock('../src/middleware/rbac',      () => ({ requirePermission: () => (_r, _s, n) => n() }));
  jest.mock('../src/middleware/validate',  () => ({ validate: () => (_r, _s, n) => n() }));
  jest.mock('../src/middleware/httpCache', () => ({
    httpCache:  () => (_r, _s, n) => n(),
    bustCache:  jest.fn().mockResolvedValue(undefined),
  }));
  jest.mock('../src/middleware/checkQuota', () => ({ quotaCheck: () => (_r, _s, n) => n() }));
  jest.mock('../src/middleware/schemas/networkLinks', () => ({
    createNetworkLink: [], updateNetworkLink: [],
  }));
  jest.mock('../src/middleware/schemas/devices', () => ({
    createDevice: [], updateDevice: [], patchDevice: [],
  }));
  jest.mock('../src/middleware/schemas/contracts', () => ({
    createContract: [], updateContract: [], patchContract: [], createContractAddon: [],
  }));
  jest.mock('../src/middleware/schemas/tickets', () => ({
    createTicket: [], updateTicket: [], patchTicket: [], createComment: [],
  }));
  jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
  jest.mock('../src/services/pubsub',   () => ({ pubsub: { publish: jest.fn() } }));
  jest.mock('../src/services/suspensionService', () => ({
    suspendContract:   jest.fn(),
    unsuspendContract: jest.fn(),
  }));
  jest.mock('../src/services/jobQueueService', () => ({
    add:      jest.fn().mockResolvedValue({ id: 'x' }),
    process:  jest.fn(),
    close:    jest.fn(),
    getStats: jest.fn(),
    QUEUE_NAMES: [],
  }));

  // Build a fake request / response helper
  function makeReqRes(params = {}, body = {}, orgId = 1) {
    const req = {
      params,
      body,
      orgId,
      user: { id: 99 },
      query: {},
    };
    const res = {
      json:   jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  // ---- NetworkLink ----------------------------------------------------------

  describe('NetworkLink route', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls invalidate("link") after PUT /:id', async () => {
      jest.mock('../src/models/NetworkLink', () => ({
        tableName:   'network_links',
        hasOrgScope: true,
        softDelete:  true,
        update:  jest.fn().mockResolvedValue({ id: 7 }),
        findById: jest.fn(),
        restore: jest.fn(),
        delete:  jest.fn(),
        create:  jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/networkLinks');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.put);

      expect(layer).toBeDefined();
      const handlers = layer.route.stack.map(l => l.handle);
      const { req, res, next } = makeReqRes({ id: '7' }, { capacity_mbps: 100 });
      // Call only the last handler (the business logic one)
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(7, 'link');
    });

    it('calls invalidate("link") after DELETE /:id', async () => {
      jest.mock('../src/models/NetworkLink', () => ({
        tableName:       'network_links',
        hasOrgScope:     true,
        softDelete:      true,
        findByIdOrFail:  jest.fn().mockResolvedValue({ id: 7 }),
        delete:          jest.fn().mockResolvedValue(true),
        update:          jest.fn(),
        create:          jest.fn(),
        restore:         jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/networkLinks');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.delete);

      expect(layer).toBeDefined();
      const handlers = layer.route.stack.map(l => l.handle);
      const { req, res, next } = makeReqRes({ id: '7' });
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(7, 'link');
    });
  });

  // ---- Device --------------------------------------------------------------

  describe('Device route', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls invalidate("device") after PUT /:id', async () => {
      jest.mock('../src/models/Device', () => ({
        tableName:   'devices',
        hasOrgScope: true,
        softDelete:  true,
        findByIdOrFail: jest.fn().mockResolvedValue({ id: 3, status: 'active' }),
        update:  jest.fn().mockResolvedValue({ id: 3, status: 'active' }),
        delete:  jest.fn(),
        restore: jest.fn(),
        create:  jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/devices');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.put);

      const { req, res, next } = makeReqRes({ id: '3' }, { status: 'active' });
      const handlers = layer.route.stack.map(l => l.handle);
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(3, 'device');
    });

    it('calls invalidate("device") after DELETE /:id', async () => {
      jest.mock('../src/models/Device', () => ({
        tableName:      'devices',
        hasOrgScope:    true,
        softDelete:     true,
        findByIdOrFail: jest.fn().mockResolvedValue({ id: 3 }),
        delete:         jest.fn().mockResolvedValue(true),
        update:         jest.fn(),
        restore:        jest.fn(),
        create:         jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/devices');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.delete);

      const { req, res, next } = makeReqRes({ id: '3' });
      const handlers = layer.route.stack.map(l => l.handle);
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(3, 'device');
    });
  });

  // ---- Contract ------------------------------------------------------------

  describe('Contract route', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls invalidate("contract") after PUT /:id', async () => {
      jest.mock('../src/models/Contract', () => ({
        tableName:      'contracts',
        hasOrgScope:    true,
        softDelete:     true,
        findByIdOrFail: jest.fn().mockResolvedValue({ id: 5, status: 'active' }),
        update:         jest.fn().mockResolvedValue({ id: 5, status: 'active' }),
        delete:         jest.fn(),
        restore:        jest.fn(),
        create:         jest.fn(),
        getAddons:      jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/contracts');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.put);

      const { req, res, next } = makeReqRes({ id: '5' }, { status: 'active' });
      const handlers = layer.route.stack.map(l => l.handle);
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(5, 'contract');
    });

    it('calls invalidate("contract") after DELETE /:id', async () => {
      jest.mock('../src/models/Contract', () => ({
        tableName:      'contracts',
        hasOrgScope:    true,
        softDelete:     true,
        findByIdOrFail: jest.fn().mockResolvedValue({ id: 5 }),
        delete:         jest.fn().mockResolvedValue(true),
        update:         jest.fn(),
        restore:        jest.fn(),
        create:         jest.fn(),
        getAddons:      jest.fn(),
      }));

      const topSvc = require('../src/services/topologyContextService');
      const router = require('../src/routes/contracts');
      const layer  = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.delete);

      const { req, res, next } = makeReqRes({ id: '5' });
      const handlers = layer.route.stack.map(l => l.handle);
      await handlers[handlers.length - 1](req, res, next);

      expect(topSvc.invalidate).toHaveBeenCalledWith(5, 'contract');
    });
  });
});

// =============================================================================
// 3. Ticket create + client comment enqueue ai-triage jobs
// =============================================================================

describe('Ticket route — aiTriage enqueue', () => {
  const mockJobAdd = jest.fn().mockResolvedValue({ id: '99' });

  jest.mock('../src/services/jobQueueService', () => ({
    add:      mockJobAdd,
    process:  jest.fn(),
    close:    jest.fn(),
    getStats: jest.fn(),
    QUEUE_NAMES: [],
  }));
  jest.mock('../src/services/topologyContextService', () => ({
    invalidate: jest.fn().mockResolvedValue(undefined),
  }));
  jest.mock('../src/middleware/auth',      () => ({ authenticate: (_r, _s, n) => n() }));
  jest.mock('../src/middleware/orgScope',  () => ({ orgScope:     (_r, _s, n) => n() }));
  jest.mock('../src/middleware/rbac',      () => ({ requirePermission: () => (_r, _s, n) => n() }));
  jest.mock('../src/middleware/validate',  () => ({ validate: () => (_r, _s, n) => n() }));
  jest.mock('../src/middleware/schemas/tickets', () => ({
    createTicket: [], updateTicket: [], patchTicket: [], createComment: [],
  }));
  jest.mock('../src/services/pubsub', () => ({ pubsub: { publish: jest.fn() } }));

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockJobAdd.mockResolvedValue({ id: '99' });
  });

  it('enqueues ai-triage job when a new ticket is created with a description', async () => {
    jest.mock('../src/models/Ticket', () => ({
      tableName:   'tickets',
      hasOrgScope: true,
      softDelete:  true,
      create:       jest.fn().mockResolvedValue({ id: 10, description: 'My internet is down', contract_id: 5 }),
      findById:     jest.fn(),
      getComments:  jest.fn().mockResolvedValue([]),
      addComment:   jest.fn(),
    }));

    const jobQueue = require('../src/services/jobQueueService');
    const router   = require('../src/routes/tickets');
    const layer    = router.stack.find(l => l.route?.path === '/' && l.route.methods.post);

    const req = { body: { description: 'My internet is down', channel: 'portal' }, orgId: 1, user: { id: 99 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    const handlers = layer.route.stack.map(l => l.handle);
    await handlers[handlers.length - 1](req, res, next);

    // Allow async fire-and-forget to settle
    await new Promise(resolve => setImmediate(resolve));

    expect(jobQueue.add).toHaveBeenCalledWith('ai-triage', expect.objectContaining({
      ticketId:    10,
      channel:     'portal',
      inboundText: 'My internet is down',
      contractId:  5,
    }));
  });

  it('does NOT enqueue ai-triage when ticket has no description', async () => {
    jest.mock('../src/models/Ticket', () => ({
      tableName:   'tickets',
      hasOrgScope: true,
      softDelete:  true,
      create:      jest.fn().mockResolvedValue({ id: 11, description: null, contract_id: null }),
      findById:    jest.fn(),
      getComments: jest.fn().mockResolvedValue([]),
      addComment:  jest.fn(),
    }));

    const jobQueue = require('../src/services/jobQueueService');
    const router   = require('../src/routes/tickets');
    const layer    = router.stack.find(l => l.route?.path === '/' && l.route.methods.post);

    const req = { body: {}, orgId: 1, user: { id: 99 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    const handlers = layer.route.stack.map(l => l.handle);
    await handlers[handlers.length - 1](req, res, next);
    await new Promise(resolve => setImmediate(resolve));

    expect(jobQueue.add).not.toHaveBeenCalledWith('ai-triage', expect.anything());
  });

  it('enqueues ai-triage when a non-internal comment is posted', async () => {
    // Mock DB for comment insert + ticket select
    mockDbQuery
      .mockResolvedValueOnce([{ insertId: 200 }])      // INSERT INTO ticket_comments
      .mockResolvedValueOnce([[{ id: 200, body: 'Still down' }]])   // SELECT ticket_comment
      .mockResolvedValueOnce([[{ id: 10, organization_id: 1, contract_id: 5 }]]); // SELECT ticket

    const jobQueue = require('../src/services/jobQueueService');
    const router   = require('../src/routes/tickets');
    const layer    = router.stack.find(l => l.route?.path === '/:id/comments' && l.route.methods.post);

    const req = { params: { id: '10' }, body: { body: 'Still down', is_internal: false }, orgId: 1, user: { id: 99 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    const handlers = layer.route.stack.map(l => l.handle);
    await handlers[handlers.length - 1](req, res, next);
    await new Promise(resolve => setImmediate(resolve));

    expect(jobQueue.add).toHaveBeenCalledWith('ai-triage', expect.objectContaining({
      orgId:       1,
      ticketId:    10,
      channel:     'portal',
      inboundText: 'Still down',
      contractId:  5,
    }));
  });

  it('does NOT enqueue ai-triage for internal comments', async () => {
    mockDbQuery
      .mockResolvedValueOnce([{ insertId: 201 }])
      .mockResolvedValueOnce([[{ id: 201, body: 'Internal note', is_internal: true }]]);

    const jobQueue = require('../src/services/jobQueueService');
    const router   = require('../src/routes/tickets');
    const layer    = router.stack.find(l => l.route?.path === '/:id/comments' && l.route.methods.post);

    const req = { params: { id: '10' }, body: { body: 'Internal note', is_internal: true }, orgId: 1, user: { id: 99 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    const handlers = layer.route.stack.map(l => l.handle);
    await handlers[handlers.length - 1](req, res, next);
    await new Promise(resolve => setImmediate(resolve));

    expect(jobQueue.add).not.toHaveBeenCalledWith('ai-triage', expect.anything());
  });
});
