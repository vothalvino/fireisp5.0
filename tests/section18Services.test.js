// =============================================================================
// FireISP 5.0 — §18 Service + Route Coverage (scriptingService + extra routes)
// Separate file so scriptingService is NOT mocked (unlike section18Extended
// which must mock it for route-level tests on automationScripts).
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));
jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn(v => `enc:${v}`),
  decrypt: jest.fn(v => v.replace(/^enc:/, '')),
}));
jest.mock('../src/services/reportService', () => ({
  capacityForecast: jest.fn().mockResolvedValue({ months: 6, data: [], note: 'mock' }),
}));

// Route-test middleware mocks
jest.mock('../src/middleware/auth',     () => ({ authenticate: (_q, _r, next) => { _q.user = { id: 1, role: 'admin' }; next(); } }));
jest.mock('../src/middleware/orgScope', () => ({ orgScope: (_q, _r, next) => { _q.orgId = 1; next(); } }));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_q, _r, next) => next(),
  requireRole:       () => (_q, _r, next) => next(),
}));
jest.mock('../src/middleware/rateLimit', () => ({
  apiLimiter:   (_q, _r, next) => next(),
  authLimiter:  (_q, _r, next) => next(),
  exportLimiter:(_q, _r, next) => next(),
  sseLimiter:   (_q, _r, next) => next(),
  webhookLimiter:(_q, _r, next) => next(),
}));
jest.mock('../src/middleware/checkQuota', () => ({ quotaCheck: () => (_q, _r, next) => next() }));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_q, _r, next) => next(),
  parseAllowlist: () => [],
}));

// Task-runner dependency mocks (needed to load app.js)
jest.mock('../src/services/billingService',           () => ({ generateBillingPeriod: jest.fn(), generateInvoice: jest.fn() }));
jest.mock('../src/services/suspensionService',        () => ({ evaluateRules: jest.fn(), suspendContract: jest.fn() }));
jest.mock('../src/services/radiusService',            () => ({ syncAllAccounts: jest.fn(), syncFreeradiusTables: jest.fn(), checkCertificateExpiry: jest.fn(), kickDuplicateSessions: jest.fn() }));
jest.mock('../src/services/snmpPoller',               () => ({ poll: jest.fn() }));
jest.mock('../src/services/snmpTrapReceiver',         () => ({ stop: jest.fn(), start: jest.fn() }));
jest.mock('../src/services/emailTransport',           () => ({ processQueue: jest.fn(), sendEmail: jest.fn() }));
jest.mock('../src/services/smsTransport',             () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/webhookService',           () => ({ processRetries: jest.fn() }));
jest.mock('../src/services/checkoutService',          () => ({ processRecurringCharges: jest.fn() }));
jest.mock('../src/services/alertService',             () => ({ evaluateAlerts: jest.fn() }));
jest.mock('../src/services/retentionService',         () => ({ runAll: jest.fn() }));
jest.mock('../src/services/paymentRetryService',      () => ({ processPendingRetries: jest.fn() }));
jest.mock('../src/services/configBackupService',      () => ({ runNightlyBackups: jest.fn() }));
jest.mock('../src/services/drDrillService',           () => ({ runDrill: jest.fn() }));
jest.mock('../src/services/interactionService',       () => ({ processDueReminders: jest.fn(), dispatchTicketSurveys: jest.fn(), autoEscalateTickets: jest.fn() }));
jest.mock('../src/services/campaignService',          () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/lateFeeService',           () => ({ applyLateFees: jest.fn() }));
jest.mock('../src/services/paymentReminderService',   () => ({ sendPaymentReminders: jest.fn() }));
jest.mock('../src/services/assetService',             () => ({ getLowStockItems: jest.fn() }));
jest.mock('../src/services/scheduledReportService',   () => ({ processScheduledReports: jest.fn() }));
jest.mock('../src/views/emailTemplates',              () => ({ invoiceEmail: jest.fn(() => ({ subject: 'S', html: 'H' })) }));
jest.mock('../src/scripts/backup',                    () => ({ backup: jest.fn() }));
jest.mock('../src/services/routerosService',          () => ({
  listInterfaces: jest.fn(), pppoeCreate: jest.fn(), pppoeDelete: jest.fn(), queueSet: jest.fn(),
}));

// NOTE: scriptingService is NOT mocked here — we test the real implementation.

const request = require('supertest');
const db      = require('../src/config/database');

function mockRow(row)       { return [[row], []]; }
function mockRows(rows)     { return [rows, []]; }
function mockInsert(id = 1) { return [{ insertId: id, affectedRows: 1 }]; }
function mockUpdate()       { return [{ affectedRows: 1 }]; }
function mockEmpty()        { return [[], []]; }
function mockCount(n)       { return [[{ total: n }], []]; }

const logger = require('../src/utils/logger');
beforeEach(() => {
  db.query.mockReset();
  // Also reset logger mock implementation queues so one test's
  // mockImplementationOnce throwns don't bleed into the next test.
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

// =============================================================================
// scriptingService — Unit Tests
// =============================================================================

describe('scriptingService', () => {
  const svc = require('../src/services/scriptingService');

  afterEach(() => jest.clearAllMocks());

  describe('listScripts', () => {
    it('returns all scripts (org + shared) with total count', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([{ id: 1, name: 'test.sh', is_shared: 0 }]))
        .mockResolvedValueOnce(mockCount(1));
      const result = await svc.listScripts(1, {});
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('filters by language', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockCount(0));
      const result = await svc.listScripts(1, { language: 'python' });
      expect(result.total).toBe(0);
      expect(db.query.mock.calls[0][0]).toContain('language = ?');
    });

    it('filters by is_shared=true', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([{ id: 2, name: 'shared.sh', is_shared: 1 }]))
        .mockResolvedValueOnce(mockCount(1));
      const result = await svc.listScripts(1, { is_shared: true });
      expect(db.query.mock.calls[0][0]).toContain('is_shared = ?');
      expect(result.data).toHaveLength(1);
    });

    it('filters by is_shared=false', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockCount(0));
      const result = await svc.listScripts(1, { is_shared: false });
      expect(result.total).toBe(0);
    });

    it('applies pagination offset', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockCount(100));
      await svc.listScripts(1, { page: 3, limit: 10 });
      // offset = (3-1) * 10 = 20
      const params = db.query.mock.calls[0][1];
      expect(params).toContain(10);  // limit
    });
  });

  describe('createScript', () => {
    it('inserts script with all fields and returns row', async () => {
      const row = { id: 1, name: 'deploy.sh', language: 'bash', is_shared: 0 };
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce(mockRows([row]));
      const result = await svc.createScript(1, {
        name: 'deploy.sh', language: 'bash', script_body: '#!/bin/bash\necho deploy',
        is_shared: false, tags: ['deploy', 'infra'], scheduled_task_id: 5,
        api_endpoint: '/deploy', description: 'Deploy script',
      }, 99);
      expect(result.name).toBe('deploy.sh');
      expect(db.query.mock.calls[0][0]).toContain('INSERT INTO automation_scripts');
    });

    it('inserts script with minimal fields', async () => {
      const row = { id: 2, name: 'minimal.py', language: 'python' };
      db.query
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce(mockRows([row]));
      const result = await svc.createScript(1, { name: 'minimal.py', language: 'python', script_body: 'print("hi")' }, null);
      expect(result.name).toBe('minimal.py');
    });

    it('serializes tags as JSON when provided', async () => {
      const row = { id: 3, name: 't.sh' };
      db.query
        .mockResolvedValueOnce([{ insertId: 3 }])
        .mockResolvedValueOnce(mockRows([row]));
      await svc.createScript(1, { name: 't.sh', language: 'bash', script_body: '#', tags: ['a', 'b'] }, 1);
      const params = db.query.mock.calls[0][1];
      expect(params).toContain('["a","b"]');
    });

    it('sets is_shared=1 when flag is true', async () => {
      const row = { id: 4, name: 'shared.sh', is_shared: 1 };
      db.query
        .mockResolvedValueOnce([{ insertId: 4 }])
        .mockResolvedValueOnce(mockRows([row]));
      await svc.createScript(null, { name: 'shared.sh', language: 'bash', script_body: '#', is_shared: true }, 1);
      const params = db.query.mock.calls[0][1];
      expect(params).toContain(1);  // is_shared = 1
    });
  });

  describe('updateScript', () => {
    it('returns null when script not found', async () => {
      db.query.mockResolvedValueOnce(mockEmpty());
      const result = await svc.updateScript(999, 1, { name: 'x' });
      expect(result).toBeNull();
    });

    it('returns existing script when no updatable fields', async () => {
      const existing = { id: 1, name: 'test.sh' };
      db.query.mockResolvedValueOnce(mockRows([existing]));
      const result = await svc.updateScript(1, 1, {});
      expect(result).toEqual(existing);
    });

    it('updates fields and bumps version when script_body changes', async () => {
      const existing = { id: 1, name: 'test.sh', language: 'bash' };
      const updated  = { id: 1, name: 'test.sh', language: 'bash', version: 2 };
      db.query
        .mockResolvedValueOnce(mockRows([existing]))
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce(mockRows([updated]));
      const result = await svc.updateScript(1, 1, { script_body: '#!/bin/bash\necho updated' });
      expect(db.query.mock.calls[1][0]).toContain('version = version + 1');
    });

    it('updates name without bumping version', async () => {
      const existing = { id: 1, name: 'old.sh' };
      const updated  = { id: 1, name: 'new.sh' };
      db.query
        .mockResolvedValueOnce(mockRows([existing]))
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce(mockRows([updated]));
      await svc.updateScript(1, 1, { name: 'new.sh' });
      expect(db.query.mock.calls[1][0]).not.toContain('version = version + 1');
    });

    it('serializes tags when they are an array', async () => {
      const existing = { id: 1, name: 'tagged.sh' };
      const updated  = { id: 1, tags: '["infra"]' };
      db.query
        .mockResolvedValueOnce(mockRows([existing]))
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce(mockRows([updated]));
      await svc.updateScript(1, 1, { tags: ['infra'] });
      const params = db.query.mock.calls[1][1];
      expect(params[0]).toBe('["infra"]');
    });

    it('updates api_endpoint without serialization', async () => {
      const existing = { id: 1, name: 'api.sh' };
      const updated  = { id: 1, api_endpoint: '/new-endpoint' };
      db.query
        .mockResolvedValueOnce(mockRows([existing]))
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce(mockRows([updated]));
      await svc.updateScript(1, 1, { api_endpoint: '/new-endpoint' });
      expect(db.query.mock.calls[1][1]).toContain('/new-endpoint');
    });
  });

  describe('executeScript', () => {
    it('returns null when script not found', async () => {
      db.query.mockResolvedValueOnce(mockEmpty());
      const result = await svc.executeScript(999, 1, {});
      expect(result).toBeNull();
    });

    it('creates queued execution record and returns it', async () => {
      process.env.SCRIPT_EXECUTION_ENABLED = 'true';
      const script    = { id: 1, name: 'test.sh', language: 'bash' };
      const execution = { id: 10, script_id: 1, status: 'queued', organization_id: 1 };
      db.query
        .mockResolvedValueOnce(mockRows([script]))
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce(mockRows([execution]));
      const result = await svc.executeScript(1, 1, { input_params: { env: 'prod' }, triggered_by: 42 });
      expect(result.status).toBe('queued');
      expect(db.query.mock.calls[1][0]).toContain('queued');
      delete process.env.SCRIPT_EXECUTION_ENABLED;
    });

    it('creates execution without input_params', async () => {
      process.env.SCRIPT_EXECUTION_ENABLED = 'true';
      const script    = { id: 2, name: 'simple.sh', language: 'bash' };
      const execution = { id: 11, status: 'queued' };
      db.query
        .mockResolvedValueOnce(mockRows([script]))
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce(mockRows([execution]));
      const result = await svc.executeScript(1, 1, {});
      expect(result.status).toBe('queued');
      delete process.env.SCRIPT_EXECUTION_ENABLED;
    });
  });

  describe('listExecutions', () => {
    it('returns all executions without filters', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([{ id: 1, status: 'queued', script_name: 'test.sh' }]))
        .mockResolvedValueOnce(mockCount(1));
      const result = await svc.listExecutions(1, {});
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('filters by script_id and status', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockCount(0));
      const result = await svc.listExecutions(1, { script_id: 5, status: 'failed' });
      expect(db.query.mock.calls[0][0]).toContain('se.script_id = ?');
      expect(db.query.mock.calls[0][0]).toContain('se.status = ?');
    });

    it('applies pagination correctly', async () => {
      db.query
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockCount(0));
      await svc.listExecutions(1, { page: 2, limit: 25 });
      const params = db.query.mock.calls[0][1];
      expect(params).toContain(25);  // limit
    });
  });
});

// =============================================================================
// automationService — additional branch coverage
// =============================================================================

describe('automationService — additional branch coverage', () => {
  const automationService = require('../src/services/automationService');

  afterEach(() => jest.clearAllMocks());

  describe('createBatchJob — item failure path', () => {
    it('records failure status when applyBatchOperation throws', async () => {
      // An unimplemented operation throws at applyBatchOperation's default case
      // (BATCH_OPERATION_NOT_IMPLEMENTED), which createBatchJob catches and records
      // as a 'failure' item — covering the catch block.
      const job = { id: 1, name: 'FailBatch', operation: 'rate_limit', status: 'completed' };
      db.query
        .mockResolvedValueOnce([[{ entity_id: 10, entity_type: 'contract' }], []])  // targets
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])  // INSERT batch_jobs
        .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }])  // INSERT batch_job_items
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE processed_items
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE completed
        .mockResolvedValueOnce([[job], []]);
      // Even though applyBatchOperation throws, createBatchJob continues
      const result = await automationService.createBatchJob(1, {
        name: 'FailBatch', operation: 'rate_limit',
        filter_criteria: { status: 'active' },
      });
      // Result should still return a job row
      expect(result).toBeDefined();
    });
  });

  describe('runProvisioningPipeline — activate_contract with contract_id', () => {
    it('activate_contract stage with contract_id runs db.query (covers line 313)', async () => {
      // Test line 313: activate_contract with non-null contract_id
      // Use a full pipeline run but the stage won't throw
      const pipelineResult = { id: 1, name: 'ContractPipeline', status: 'completed' };
      db.query
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])  // INSERT pipeline
        // Stage 0 (assign_ip)
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE current_stage
        .mockResolvedValueOnce([{ insertId: 10 }])        // INSERT stage
        .mockResolvedValueOnce([{ affectedRows: 1 }])    // UPDATE stage completed
        // Stage 1 (configure_device)
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Stage 2 (activate_contract — WITH contract_id)
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE current_stage
        .mockResolvedValueOnce([{ insertId: 12 }])        // INSERT stage
        .mockResolvedValueOnce([{ affectedRows: 1 }])    // UPDATE contracts
        .mockResolvedValueOnce([{ affectedRows: 1 }])    // UPDATE stage completed
        // Stage 3 (send_notification)
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 13 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Final
        .mockResolvedValueOnce([{ affectedRows: 1 }])            // UPDATE pipeline completed
        .mockResolvedValueOnce([[pipelineResult], []]);            // SELECT final

      const result = await automationService.runProvisioningPipeline(1, {
        name: 'ContractPipeline', contract_id: 5, client_id: null, triggered_by: 1,
      });
      expect(result.status).toBe('completed');
      // Verify UPDATE contracts was called
      const contractUpdateCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes("UPDATE contracts SET status = 'active'"),
      );
      expect(contractUpdateCall).toBeDefined();
    });
  });

  describe('runProvisioningPipeline — stage failure path (covers lines 271-274)', () => {
    it('marks pipeline as failed when a stage db.query rejects', async () => {
      // Cause the activate_contract stage to fail by rejecting its db.query call.
      // The pipeline catches this, sets status=failed, and breaks out of the loop.
      const pipelineFailed = { id: 1, name: 'FailPipeline', status: 'failed' };
      db.query
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])  // INSERT pipeline
        // Stage 0 (assign_ip)
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE current_stage
        .mockResolvedValueOnce([{ insertId: 10 }])        // INSERT stage
        .mockResolvedValueOnce([{ affectedRows: 1 }])    // UPDATE stage completed
        // Stage 1 (configure_device)
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Stage 2 (activate_contract — contract_id=5, UPDATE contracts rejects)
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE current_stage
        .mockResolvedValueOnce([{ insertId: 12 }])        // INSERT stage
        .mockRejectedValueOnce(new Error('DB connection lost'))  // UPDATE contracts FAILS
        // After failure: UPDATE stage status='failed'
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Pipeline breaks — no more stages
        .mockResolvedValueOnce([{ affectedRows: 1 }])            // UPDATE pipeline failed
        .mockResolvedValueOnce([[pipelineFailed], []]);           // SELECT final

      const result = await automationService.runProvisioningPipeline(1, {
        name: 'FailPipeline', contract_id: 5, client_id: null, triggered_by: 1,
      });
      expect(result.status).toBe('failed');
    });
  });

  describe('checkRemediationCondition — default operator', () => {
    it('returns false for unknown condition_operator', async () => {
      const rule = {
        id: 1, condition_metric: 'cpu_usage', condition_operator: 'unknown_op',
        condition_threshold: 50, action_type: 'log',
        cooldown_minutes: 0, last_triggered_at: null,
      };
      db.query
        .mockResolvedValueOnce([[rule], []])  // rules
        .mockResolvedValueOnce([[{ metric_value: '80', device_id: 1 }], []]);  // metric
      // condition not met (unknown_op returns false) → triggered=0
      const result = await automationService.evaluateRemediationRules(1);
      expect(result.triggered).toBe(0);
    });
  });
});

// =============================================================================
// automationRules routes — extended coverage
// (Same mocks, separate file from section18Extended so there's no scriptingService clash)
// =============================================================================

const app = require('../src/app');

describe('automationRules routes — additional coverage', () => {
  it('GET /api/automation-rules filters by is_enabled', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1', is_enabled: 1 }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/automation-rules?is_enabled=true');
    expect(res.status).toBe(200);
  });

  it('GET /api/automation-rules/:id returns rule', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1' }]));
    const res = await request(app).get('/api/automation-rules/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('GET /api/automation-rules/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/automation-rules/9999');
    expect(res.status).toBe(404);
  });

  it('PUT /api/automation-rules/:id returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).put('/api/automation-rules/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/automation-rules/:id returns 422 when no updatable fields', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1 }]));
    const res = await request(app).put('/api/automation-rules/1').send({});
    expect(res.status).toBe(422);
  });

  it('PUT /api/automation-rules/:id updates successfully with object fields', async () => {
    const updated = { id: 1, name: 'Updated', trigger_event: 'device.offline', action_type: 'send_notification' };
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate())
      .mockResolvedValueOnce(mockRows([updated]));
    const res = await request(app).put('/api/automation-rules/1').send({
      trigger_conditions: { field: 'status', operator: 'eq', value: 'offline' },
      action_config: { channel: 'email' },
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/automation-rules/:id/execute returns 404 when rule not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/automation-rules/9999/execute').send({});
    expect(res.status).toBe(404);
  });

  it('POST /api/automation-rules/:id/execute triggers evaluation', async () => {
    const rule = { id: 1, trigger_event: 'device.offline' };
    db.query
      .mockResolvedValueOnce(mockRows([rule]))  // SELECT rule
      .mockResolvedValueOnce(mockRows([]));      // evaluateAutomationRules → SELECT rules (none match)
    const res = await request(app).post('/api/automation-rules/1/execute').send({ payload: { status: 'offline' } });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('rule_id', 1);
    expect(res.body.data).toHaveProperty('result');
  });

  it('GET /api/automation-rules/:id/executions returns list', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 10, status: 'success' }]));
    const res = await request(app).get('/api/automation-rules/1/executions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// =============================================================================
// analyticsAI routes — extended coverage (missing filter branches)
// =============================================================================

describe('analyticsAI routes — additional coverage', () => {
  it('GET /api/analytics/anomalies filters by metric and device_id', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, metric: 'cpu_usage', severity: 'high' }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/analytics/anomalies?metric=cpu_usage&device_id=5');
    expect(res.status).toBe(200);
  });

  it('GET /api/analytics/anomalies filters by is_acknowledged=false', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));
    const res = await request(app).get('/api/analytics/anomalies?is_acknowledged=false');
    expect(res.status).toBe(200);
  });

  it('GET /api/analytics/alert-correlation accepts window_minutes param', async () => {
    db.query.mockResolvedValueOnce(mockRows([]));
    const res = await request(app).get('/api/analytics/alert-correlation?window_minutes=60');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('window_minutes', 60);
  });

  it('GET /api/analytics/bandwidth-forecast accepts months param', async () => {
    const res = await request(app).get('/api/analytics/bandwidth-forecast?months=3');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('analytics_note');
  });

  it('GET /api/analytics/churn-scores with risk_band filter', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, score: 80 }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/analytics/churn-scores?risk_band=critical');
    expect(res.status).toBe(200);
  });

  it('POST /api/analytics/anomalies/detect with window param', async () => {
    db.query.mockResolvedValueOnce(mockRows([]));  // combos
    const res = await request(app).post('/api/analytics/anomalies/detect?window=24');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('combos_checked');
  });
});

// =============================================================================
// provisioningPipelines routes — extended coverage
// =============================================================================

describe('provisioningPipelines routes — additional coverage', () => {
  it('GET /api/provisioning-pipelines filters by status', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'P1', status: 'completed' }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/provisioning-pipelines?status=completed');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/provisioning-pipelines/:id returns pipeline with stages', async () => {
    const pipeline = { id: 1, name: 'P1', status: 'completed' };
    const stages   = [{ id: 10, stage_name: 'assign_ip', status: 'completed' }];
    db.query
      .mockResolvedValueOnce(mockRows([pipeline]))
      .mockResolvedValueOnce(mockRows(stages));
    const res = await request(app).get('/api/provisioning-pipelines/1');
    expect(res.status).toBe(200);
    expect(res.body.data.stages).toHaveLength(1);
  });

  it('GET /api/provisioning-pipelines/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/provisioning-pipelines/9999');
    expect(res.status).toBe(404);
  });
});
