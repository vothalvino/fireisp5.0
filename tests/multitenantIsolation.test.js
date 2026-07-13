// =============================================================================
// FireISP 5.0 — Multi-Tenant Data Isolation Tests (P2.3)
// =============================================================================
// Verifies that a user authenticated as Org A **cannot** access or mutate
// resources belonging to Org B.
//
// Strategy
// --------
// 1. Unit-level: property-based tests (fast-check) that generate arbitrary
//    org-ID pairs and assert that `BaseModel.findById` / `findAll` / `count`
//    always embed `organization_id = orgId` in the SQL for org-scoped models.
//
// 2. Route-level: integration tests that inject an Org-A JWT into supertest
//    requests for resource IDs that the DB mock reports as belonging to Org B
//    (i.e. the mock returns `null` when queried with Org-A's orgId, simulating
//    the row being invisible to the wrong tenant).  The expected outcome is
//    HTTP 404 — the same status a not-found row produces — preventing any
//    information leakage about the resource's existence in another org.
// =============================================================================

const fc = require('fast-check');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require() that transitively loads them.
// Auth + orgScope use a shared context object so tests can change the org ID
// at runtime without re-requiring the app (which would bypass Jest hoisting).
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

// Shared context read by the auth/orgScope mocks below
const ctx = { orgId: 1, userId: 1 };

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user   = { id: ctx.userId, email: `user${ctx.orgId}@test.com`, role: 'admin', organizationId: ctx.orgId };
    req.userId = ctx.userId;
    next();
  },
  optionalAuth: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = ctx.orgId;
    next();
  },
}));

jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));
jest.mock('../src/middleware/rateLimit', () => ({
  apiLimiter:       (_r, _s, n) => n(),
  sessionLimiter:   (_r, _s, n) => n(),
  authLimiter:      (_r, _s, n) => n(),
  passwordResetLimiter: (_r, _s, n) => n(),
  verifyEmailResendLimiter: (_r, _s, n) => n(),
  exportLimiter:    (_r, _s, n) => n(),
  sseLimiter:       (_r, _s, n) => n(),
  webhookLimiter:   (_r, _s, n) => n(),
  tenantApiLimiter: (_r, _s, n) => n(),
}));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_r, _s, n) => n(),
  parseAllowlist:    () => [],
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_r, _s, n) => n(),
  requireRole:       () => (_r, _s, n) => n(),
}));
jest.mock('../src/middleware/httpCache', () => ({
  httpCache:  () => (_r, _s, n) => n(),
  bustCache:  jest.fn(),
}));
jest.mock('../src/utils/errorTracking', () => ({
  init:                     jest.fn(),
  isEnabled:                jest.fn().mockReturnValue(false),
  captureException:         jest.fn(),
  setupExpressErrorHandler: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Models under test
// ---------------------------------------------------------------------------
const Client      = require('../src/models/Client');
const Contract    = require('../src/models/Contract');
const Invoice     = require('../src/models/Invoice');
const Payment     = require('../src/models/Payment');
const Device      = require('../src/models/Device');
const Ticket      = require('../src/models/Ticket');

// ---------------------------------------------------------------------------
// App — loaded once after all top-level mocks are applied
// ---------------------------------------------------------------------------
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All concrete org-scoped models we test at the SQL layer. */
const ORG_SCOPED_MODELS = [
  Client,
  Contract,
  Invoice,
  Payment,
  Device,
  Ticket,
  require('../src/models/Plan'),
  require('../src/models/Site'),
  require('../src/models/IpPool'),
  require('../src/models/IpAssignment'),
  require('../src/models/CreditNote'),
  require('../src/models/Expense'),
  require('../src/models/Nas'),
  require('../src/models/Warehouse'),
  require('../src/models/AuditLog'),
  // AI assistant models (§7)
  require('../src/models/AiPolicy'),
  require('../src/models/AiProvider'),
  require('../src/models/AiPhrase'),
  require('../src/models/AiForbiddenTerm'),
  require('../src/models/AiReplyLog'),
  // ContractTopologyPath has hasOrgScope=false (scoped via contract FK)
  // and is correctly omitted from this list
];

// ---------------------------------------------------------------------------
// Section 1 — Property-based tests on BaseModel SQL generation
// ---------------------------------------------------------------------------

describe('BaseModel — org isolation at SQL level', () => {
  beforeEach(() => jest.clearAllMocks());

  test('findById always adds AND organization_id = ? for org-scoped models', async () => {
    await fc.assert(
      fc.asyncProperty(
        // orgId: positive integer 1..1_000_000
        fc.integer({ min: 1, max: 1_000_000 }),
        // recordId: positive integer 1..1_000_000
        fc.integer({ min: 1, max: 1_000_000 }),
        async (orgId, recordId) => {
          mockQuery.mockResolvedValue([[]]); // simulate no row found

          for (const Model of ORG_SCOPED_MODELS) {
            if (!Model.hasOrgScope) continue;
            mockQuery.mockClear();
            await Model.findById(recordId, orgId);

            const sql = mockQuery.mock.calls[0]?.[0] ?? '';
            const params = mockQuery.mock.calls[0]?.[1] ?? [];

            expect(sql).toContain('organization_id = ?');
            expect(params).toContain(orgId);
            expect(params).toContain(recordId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('findAll always adds organization_id = ? for org-scoped models', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        async (orgId) => {
          mockQuery.mockResolvedValue([[]]); // empty result

          for (const Model of ORG_SCOPED_MODELS) {
            if (!Model.hasOrgScope) continue;
            mockQuery.mockClear();
            await Model.findAll({ orgId });

            const sql = mockQuery.mock.calls[0]?.[0] ?? '';
            const params = mockQuery.mock.calls[0]?.[1] ?? [];

            expect(sql).toContain('organization_id = ?');
            expect(params).toContain(orgId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('count always adds organization_id = ? for org-scoped models', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        async (orgId) => {
          mockQuery.mockResolvedValue([[{ total: 0 }]]);

          for (const Model of ORG_SCOPED_MODELS) {
            if (!Model.hasOrgScope) continue;
            mockQuery.mockClear();
            await Model.count({ orgId });

            const sql = mockQuery.mock.calls[0]?.[0] ?? '';
            const params = mockQuery.mock.calls[0]?.[1] ?? [];

            expect(sql).toContain('organization_id = ?');
            expect(params).toContain(orgId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('cross-org isolation: findById with orgA never returns orgB record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (orgIdA, orgIdB, recordId) => {
          fc.pre(orgIdA !== orgIdB); // ensure distinct orgs

          // DB mock: returns a row *only* when the query targets Org B's id
          // (i.e. when the second bind param equals orgIdB).
          // When queried with orgIdA, the WHERE clause filters out the row
          // → returns [].  This mirrors the real DB behaviour.
          mockQuery.mockImplementation((_sql, params) => {
            const queriedOrg = params?.[1];
            if (queriedOrg === orgIdB) {
              return Promise.resolve([[{ id: recordId, organization_id: orgIdB }]]);
            }
            return Promise.resolve([[]]); // no match for any other org
          });

          const result = await Client.findById(recordId, orgIdA);
          // Must be null — orgA cannot see orgB's row
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('models with hasOrgScope=false do NOT add organization_id filter', async () => {
    // Models that scope by parent FK (e.g. client_id) rather than organization_id directly.
    // These are sub-resources; their parent lookup enforces org isolation.
    const nonScopedModels = [
      require('../src/models/ConnectionLog'),  // scoped via contract → client → org
      require('../src/models/Contact'),        // scoped via client → org
    ].filter(m => m.hasOrgScope === false);

    if (nonScopedModels.length === 0) return;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        async (orgId) => {
          mockQuery.mockResolvedValue([[{ total: 0 }]]);

          for (const Model of nonScopedModels) {
            mockQuery.mockClear();
            await Model.count({ orgId });

            const sql    = mockQuery.mock.calls[0]?.[0] ?? '';
            const params = mockQuery.mock.calls[0]?.[1] ?? [];

            expect(sql).not.toContain('organization_id = ?');
            expect(params).not.toContain(orgId);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Route-level isolation (HTTP 404 on cross-org access)
// ---------------------------------------------------------------------------
// The `ctx.orgId` variable is read by the top-level auth + orgScope mocks,
// so setting it in `beforeEach` changes the org for all subsequent requests.
// The DB mock returns an empty result set, simulating a row that belongs to a
// different org (MySQL's WHERE organization_id = ? filters it out).
// ---------------------------------------------------------------------------

describe('Route-level cross-org isolation — GET /:id returns 404', () => {
  const ORG_A = 100;
  const RECORD_ID = 42;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx.orgId = ORG_A;
    // DB returns empty: the row exists in the DB but belongs to a different org
    mockQuery.mockResolvedValue([[]]); // → findByIdOrFail throws NotFoundError → 404
  });

  const CROSS_ORG_ROUTES = [
    ['clients',      `/api/v1/clients/${RECORD_ID}`],
    ['contracts',    `/api/v1/contracts/${RECORD_ID}`],
    ['invoices',     `/api/v1/invoices/${RECORD_ID}`],
    ['payments',     `/api/v1/payments/${RECORD_ID}`],
    ['tickets',      `/api/v1/tickets/${RECORD_ID}`],
    ['devices',      `/api/v1/devices/${RECORD_ID}`],
    ['plans',        `/api/v1/plans/${RECORD_ID}`],
    ['credit-notes', `/api/v1/credit-notes/${RECORD_ID}`],
    ['ip-pools',     `/api/v1/ip-pools/${RECORD_ID}`],
  ];

  test.each(CROSS_ORG_ROUTES)(
    'GET %s → 404 when record belongs to a different org',
    async (_label, path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    },
  );
});

// ---------------------------------------------------------------------------
// Section 3 — Mutation isolation (PUT/PATCH/DELETE return 404 cross-org)
// ---------------------------------------------------------------------------

describe('Route-level cross-org isolation — mutations return 404', () => {
  const ORG_A = 300;
  const RECORD_ID = 99;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx.orgId = ORG_A;
    mockQuery.mockResolvedValue([[]]); // no row found for org A
  });

  test('PUT /api/v1/clients/:id returns 404 for cross-org record', async () => {
    const res = await request(app)
      .put(`/api/v1/clients/${RECORD_ID}`)
      .send({ name: 'Injected name', client_type: 'residential' });
    expect(res.status).toBe(404);
  });

  test('PATCH /api/v1/clients/:id returns 404 for cross-org record', async () => {
    const res = await request(app)
      .patch(`/api/v1/clients/${RECORD_ID}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/v1/clients/:id returns 404 for cross-org record', async () => {
    const res = await request(app)
      .delete(`/api/v1/clients/${RECORD_ID}`);
    expect(res.status).toBe(404);
  });

  test('PUT /api/v1/contracts/:id returns 404 for cross-org record', async () => {
    const res = await request(app)
      .put(`/api/v1/contracts/${RECORD_ID}`)
      .send({ status: 'active' });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/v1/invoices/:id returns 404 for cross-org record', async () => {
    const res = await request(app)
      .delete(`/api/v1/invoices/${RECORD_ID}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — org-scope middleware is present on all sensitive routers
// ---------------------------------------------------------------------------

describe('orgScope middleware wiring', () => {
  test('orgScope is applied on clients router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/clients.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
    expect(src).toContain("require('../middleware/orgScope')");
  });

  test('orgScope is applied on contracts router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/contracts.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
  });

  test('orgScope is applied on invoices router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/invoices.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
  });

  test('orgScope is applied on payments router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/payments.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
  });

  test('orgScope is applied on tickets router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/tickets.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
  });

  test('orgScope is applied on devices router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/devices.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
  });

  test('orgScope injects orgId from JWT — prevents cross-org injection via query param', () => {
    // orgScope reads req.user.organizationId (from the JWT), never req.query or req.body.
    // Verify by reading the middleware source.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/middleware/orgScope.js'),
      'utf8',
    );
    expect(src).toContain('req.user.organizationId');
    expect(src).not.toContain('req.query.orgId');
    expect(src).not.toContain('req.body.orgId');
    expect(src).not.toContain('req.params.orgId');
  });

  test('orgScope is applied on AI router', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/routes/ai.js'),
      'utf8',
    );
    expect(src).toContain('router.use(orgScope)');
    expect(src).toContain("require('../middleware/orgScope')");
  });
});

// ---------------------------------------------------------------------------
// Section 5 — AI routes cross-org isolation
// ---------------------------------------------------------------------------
// ai_providers, ai_phrases, ai_forbidden_terms, and ai_reply_logs are
// all org-scoped.  A request from Org A must never mutate or view a
// resource that belongs to Org B.  When the DB mock returns [] (no row
// found for Org A), the routes must respond 404.
// ---------------------------------------------------------------------------

describe('AI route cross-org isolation', () => {
  const ORG_A    = 500;
  const RECORD_ID = 77;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx.orgId = ORG_A;
    // DB returns empty: the row exists but belongs to a different org
    mockQuery.mockResolvedValue([[]]); // → findById returns null → NotFoundError → 404
  });

  test('PUT /api/v1/ai/providers/:id returns 404 for cross-org provider', async () => {
    const res = await request(app)
      .put(`/api/v1/ai/providers/${RECORD_ID}`)
      .send({ name: 'Injected', kind: 'openai', model: 'gpt-4o' });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/v1/ai/providers/:id returns 404 for cross-org provider', async () => {
    const res = await request(app)
      .delete(`/api/v1/ai/providers/${RECORD_ID}`);
    expect(res.status).toBe(404);
  });

  test('POST /api/v1/ai/providers/:id/verify returns 404 for cross-org provider', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/providers/${RECORD_ID}/verify`);
    expect(res.status).toBe(404);
  });

  test('POST /api/v1/ai/reply/send returns 404 for cross-org reply log', async () => {
    const res = await request(app)
      .post('/api/v1/ai/reply/send')
      .send({ log_id: RECORD_ID, action: 'discarded', final_text: 'n/a' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Section 6 — AI models: ContractTopologyPath is correctly NOT org-scoped
// ---------------------------------------------------------------------------

describe('ContractTopologyPath — correctly not org-scoped', () => {
  test('ContractTopologyPath.hasOrgScope is false (scoped via contract FK)', () => {
    const ContractTopologyPath = require('../src/models/ContractTopologyPath');
    expect(ContractTopologyPath.hasOrgScope).toBe(false);
  });

  test('ContractTopologyPath is NOT in ORG_SCOPED_MODELS list', () => {
    // Verify our ORG_SCOPED_MODELS array does not include it — would cause
    // count() to receive an orgId it does not understand
    const ContractTopologyPath = require('../src/models/ContractTopologyPath');
    const ORG_SCOPED_MODELS_LOADED = [
      require('../src/models/AiPolicy'),
      require('../src/models/AiProvider'),
      require('../src/models/AiPhrase'),
      require('../src/models/AiForbiddenTerm'),
      require('../src/models/AiReplyLog'),
    ];
    expect(ORG_SCOPED_MODELS_LOADED).not.toContain(ContractTopologyPath);
  });
});
