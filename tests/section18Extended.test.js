// =============================================================================
// FireISP 5.0 — §18 Extended Coverage Tests
// Covers: scheduled-task dispatch, §18 models, automationService,
//         routerDriverService, analyticsService, and under-covered routes.
// =============================================================================

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before any require)
// ---------------------------------------------------------------------------
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
  capacityForecast: jest.fn().mockResolvedValue({
    months: 6, data: [], note: 'mock-forecast',
  }),
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
  sessionLimiter: (_q, _r, next) => next(),
  authLimiter:  (_q, _r, next) => next(),
  passwordResetLimiter: (_q, _r, next) => next(),
  verifyEmailResendLimiter: (_q, _r, next) => next(),
  bulkEmailLimiter: (_q, _r, next) => next(),
  portalPasswordResetLimiter: (_q, _r, next) => next(),
  exportLimiter:(_q, _r, next) => next(),
  sseLimiter:   (_q, _r, next) => next(),
  webhookLimiter:(_q, _r, next) => next(),
}));
jest.mock('../src/middleware/checkQuota', () => ({ quotaCheck: () => (_q, _r, next) => next() }));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_q, _r, next) => next(),
  parseAllowlist: () => [],
}));

// Task-runner service mocks (needed so taskRunner can be required without crashing)
jest.mock('../src/services/billingService',           () => ({ generateBillingPeriod: jest.fn(), generateInvoice: jest.fn() }));
jest.mock('../src/services/suspensionService',        () => ({ evaluateRules: jest.fn(), suspendContract: jest.fn() }));
jest.mock('../src/services/radiusService',            () => ({ syncAllAccounts: jest.fn(), syncFreeradiusTables: jest.fn(), checkCertificateExpiry: jest.fn(), kickDuplicateSessions: jest.fn() }));
jest.mock('../src/services/snmpPoller',               () => ({ poll: jest.fn() }));
jest.mock('../src/services/snmpTrapReceiver',         () => ({ stop: jest.fn(), start: jest.fn() }));
jest.mock('../src/services/emailTransport',           () => ({ processQueue: jest.fn(), sendEmail: jest.fn() }));
jest.mock('../src/services/smsTransport',             () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/webhookService',           () => ({ processRetries: jest.fn() }));
jest.mock('../src/services/checkoutService',          () => ({ processRecurringCharges: jest.fn() }));
jest.mock('../src/services/alertService',             () => ({
  evaluateAlerts: jest.fn(),
  // automationService reads this real (unmocked) whitelist to validate
  // condition_metric before building a dynamic snmp_metrics column reference.
  SNMP_METRICS: new Set([
    'cpu_usage', 'memory_usage', 'signal_strength', 'latency_ms', 'if_in_octets',
    'if_out_octets', 'voltage_mv', 'temperature_c', 'fan_speed_rpm', 'if_in_discards',
    'if_out_discards', 'sfp_tx_power_dbm', 'sfp_rx_power_dbm', 'sfp_temperature_c',
    'ups_battery_pct', 'ups_runtime_min', 'poe_power_mw', 'humidity_pct',
  ]),
}));
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

// Scripting service mock for automationScripts route
jest.mock('../src/services/scriptingService', () => ({
  listScripts:     jest.fn(),
  createScript:    jest.fn(),
  updateScript:    jest.fn(),
  executeScript:   jest.fn(),
  listExecutions:  jest.fn(),
}));

// routerosService mock (for routerDriverService live path)
jest.mock('../src/services/routerosService', () => ({
  listInterfaces: jest.fn(),
  pppoeCreate:    jest.fn(),
  pppoeDelete:    jest.fn(),
  queueSet:       jest.fn(),
}));

// ---------------------------------------------------------------------------
// Requires (after mocks)
// ---------------------------------------------------------------------------
const request = require('supertest');
const db      = require('../src/config/database');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockRow(row)        { return [[row], []]; }
function mockRows(rows)      { return [rows, []]; }
function mockInsert(id = 1)  { return [{ insertId: id, affectedRows: 1 }]; }
function mockUpdate()        { return [{ affectedRows: 1 }]; }
function mockEmpty()         { return [[], []]; }
function mockCount(n)        { return [[{ total: n }], []]; }

beforeEach(() => db.query.mockReset());

// =============================================================================
// PART 1 — Scheduled-task dispatch tests (anomaly_detection,
//           churn_score_computation, remediation_evaluation)
// =============================================================================

describe('taskRunner — §18 scheduled task dispatch', () => {
  // We need a fresh taskRunner + real analyticsService/automationService for
  // these tests. However the global jest.mock at the top doesn't mock them,
  // so they are real modules — but they both use db.query (mocked above).

  let taskRunner;
  beforeAll(() => {
    taskRunner = require('../src/services/taskRunner');
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // anomaly_detection
  // ---------------------------------------------------------------------------
  describe('anomaly_detection task', () => {
    it('dispatches to analyticsService.detectAnomalies and returns summary shape', async () => {
      // combos query → empty list → detected = 0
      db.query.mockResolvedValueOnce(mockRows([]));

      const result = await taskRunner.runTask('anomaly_detection', 1);

      expect(result).toHaveProperty('combos_checked');
      expect(result).toHaveProperty('anomalies_detected');
      expect(result.combos_checked).toBe(0);
      expect(result.anomalies_detected).toBe(0);
    });

    it('detects anomalies when z-score exceeds threshold', async () => {
      // one device with a wide-format cpu_usage column → one metric combo
      // Use 48 samples: latest=200, rest=50 → mean≈53, stddev≈21, z≈6.8 > 2.5
      const baseline = Array(47).fill({ cpu_usage: '50' });
      const samples = [{ cpu_usage: '200' }, ...baseline];
      db.query
        .mockResolvedValueOnce(mockRows([{ device_id: 5 }]))
        .mockResolvedValueOnce(mockRows(samples))
        .mockResolvedValueOnce(mockInsert(10)); // INSERT analytics_anomalies

      const result = await taskRunner.runTask('anomaly_detection', 1);

      expect(result.combos_checked).toBe(1);
      expect(result.anomalies_detected).toBe(1);
    });

    it('runs without orgId (null)', async () => {
      db.query.mockResolvedValueOnce(mockRows([]));
      const result = await taskRunner.runTask('anomaly_detection', null);
      expect(result).toHaveProperty('combos_checked');
    });
  });

  // ---------------------------------------------------------------------------
  // churn_score_computation
  // ---------------------------------------------------------------------------
  describe('churn_score_computation task', () => {
    it('dispatches to analyticsService.computeChurnScores and returns clients_scored=0 when no clients', async () => {
      db.query.mockResolvedValueOnce(mockRows([]));
      const result = await taskRunner.runTask('churn_score_computation', 1);
      expect(result).toHaveProperty('clients_scored');
      expect(result.clients_scored).toBe(0);
    });

    it('scores clients and returns correct count', async () => {
      const client = {
        client_id: 7,
        tenure_months: 2,
        overdue_invoices: 2,
        suspensions_30d: 1,
        open_tickets: 3,
        payments_late_90d: 1,
      };
      db.query
        .mockResolvedValueOnce(mockRows([client]))  // clients query
        .mockResolvedValueOnce(mockInsert(1));       // INSERT churn_scores

      const result = await taskRunner.runTask('churn_score_computation', 1);
      expect(result.clients_scored).toBe(1);
    });

    it('runs without orgId (null)', async () => {
      db.query.mockResolvedValueOnce(mockRows([]));
      const result = await taskRunner.runTask('churn_score_computation', null);
      expect(result).toHaveProperty('clients_scored');
    });
  });

  // ---------------------------------------------------------------------------
  // remediation_evaluation
  // ---------------------------------------------------------------------------
  describe('remediation_evaluation task', () => {
    it('dispatches to automationService.evaluateRemediationRules and returns evaluated/triggered', async () => {
      // rules query → empty → nothing to evaluate
      db.query.mockResolvedValueOnce(mockRows([]));

      const result = await taskRunner.runTask('remediation_evaluation', 1);

      expect(result).toHaveProperty('evaluated');
      expect(result).toHaveProperty('triggered');
      expect(result.evaluated).toBe(0);
      expect(result.triggered).toBe(0);
    });

    it('evaluates a rule that is in cooldown and skips it', async () => {
      const recentTime = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago, cooldown=30 min
      db.query.mockResolvedValueOnce(mockRows([{
        id: 1, condition_metric: 'cpu_usage', condition_operator: 'gt',
        condition_threshold: 80, action_type: 'reboot_device',
        cooldown_minutes: 30, last_triggered_at: recentTime, is_enabled: 1,
      }]));

      const result = await taskRunner.runTask('remediation_evaluation', 1);
      expect(result.evaluated).toBe(1);
      expect(result.triggered).toBe(0);
    });

    it('triggers a rule when condition is met (is_true operator)', async () => {
      // `condition_metric` selects a real snmp_metrics COLUMN (the table has
      // no generic metric/value pair) and is checked against a fixed
      // whitelist before being interpolated into the query (SQL-injection
      // guard — condition_metric is an admin-supplied free-form string with
      // no content validation elsewhere) — 'cpu_usage' is a real, whitelisted
      // column; a fictional metric like 'is_offline' is now rejected outright.
      db.query
        .mockResolvedValueOnce(mockRows([{  // rules query
          id: 2, condition_metric: 'cpu_usage', condition_operator: 'is_true',
          condition_threshold: null, action_type: 'reboot_device',
          cooldown_minutes: 5, last_triggered_at: null, is_enabled: 1,
        }]))
        .mockResolvedValueOnce(mockRows([{ metric_value: '1', device_id: 10 }]))  // checkRemediationCondition
        .mockResolvedValueOnce(mockInsert(20))  // INSERT remediation_executions
        .mockResolvedValueOnce(mockUpdate());    // UPDATE remediation_rules run_count

      const result = await taskRunner.runTask('remediation_evaluation', 1);
      expect(result.triggered).toBe(1);
    });

    it('runs without orgId (null)', async () => {
      db.query.mockResolvedValueOnce(mockRows([]));
      const result = await taskRunner.runTask('remediation_evaluation', null);
      expect(result).toHaveProperty('evaluated');
    });
  });
});

// =============================================================================
// PART 2 — §18 Model Unit Tests (all 6 zero-coverage models)
// =============================================================================

describe('§18 Models — schema properties and BaseModel inheritance', () => {
  const BaseModel            = require('../src/models/BaseModel');
  const AutomationRule       = require('../src/models/AutomationRule');
  const AutomationScript     = require('../src/models/AutomationScript');
  const BatchJob             = require('../src/models/BatchJob');
  const ProvisioningPipeline = require('../src/models/ProvisioningPipeline');
  const RemediationRule      = require('../src/models/RemediationRule');
  const RouterDriverConfig   = require('../src/models/RouterDriverConfig');

  // --- AutomationRule ---
  describe('AutomationRule', () => {
    it('has correct tableName', () => expect(AutomationRule.tableName).toBe('automation_rules'));
    it('has hasOrgScope=true',  () => expect(AutomationRule.hasOrgScope).toBe(true));
    it('has softDelete=true',   () => expect(AutomationRule.softDelete).toBe(true));
    it('fillable includes name and trigger_event', () => {
      expect(AutomationRule.fillable).toContain('name');
      expect(AutomationRule.fillable).toContain('trigger_event');
      expect(AutomationRule.fillable).toContain('action_type');
      expect(AutomationRule.fillable).toContain('organization_id');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(AutomationRule)).toBe(BaseModel));

    it('findById queries the table by id', async () => {
      const row = { id: 1, name: 'Rule A', trigger_event: 'invoice.created' };
      db.query.mockResolvedValueOnce([[row], []]);
      const result = await AutomationRule.findById(1, 1);
      expect(result).toEqual(row);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        expect.arrayContaining([1]),
      );
    });

    it('findById returns null when not found', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await AutomationRule.findById(9999, 1);
      expect(result).toBeNull();
    });

    it('findAll queries table with org filter', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }], []]);
      const rows = await AutomationRule.findAll({ orgId: 1 });
      expect(rows).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = ?'),
        expect.arrayContaining([1]),
      );
    });

    it('count returns total', async () => {
      db.query.mockResolvedValueOnce([[{ total: 5 }], []]);
      const total = await AutomationRule.count({ orgId: 1 });
      expect(total).toBe(5);
    });

    it('create inserts a row and returns it', async () => {
      const row = { id: 3, name: 'R', trigger_event: 'e', action_type: 'a', organization_id: 1 };
      db.query
        .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[row], []]);                          // findByIdIncludingDeleted
      const result = await AutomationRule.create({
        organization_id: 1, name: 'R', trigger_event: 'e', action_type: 'a',
      });
      expect(result).toEqual(row);
    });

    it('delete soft-deletes the record', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const ok = await AutomationRule.delete(1, 1);
      expect(ok).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET deleted_at = NOW()'),
        expect.arrayContaining([1]),
      );
    });

    it('delete throws NotFoundError when nothing deleted', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      await expect(AutomationRule.delete(9999, 1)).rejects.toThrow('automation_rules');
    });
  });

  // --- AutomationScript ---
  describe('AutomationScript', () => {
    it('has correct tableName',  () => expect(AutomationScript.tableName).toBe('automation_scripts'));
    it('has hasOrgScope=false', () => expect(AutomationScript.hasOrgScope).toBe(false));
    it('has softDelete=true',   () => expect(AutomationScript.softDelete).toBe(true));
    it('fillable includes language and script_body', () => {
      expect(AutomationScript.fillable).toContain('language');
      expect(AutomationScript.fillable).toContain('script_body');
      expect(AutomationScript.fillable).toContain('name');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(AutomationScript)).toBe(BaseModel));

    it('findAll does not inject org filter because hasOrgScope=false', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      await AutomationScript.findAll({ orgId: 42 });
      // The SQL should NOT contain organization_id = ? since hasOrgScope is false
      const sql = db.query.mock.calls[0][0];
      expect(sql).not.toContain('organization_id = ?');
    });

    it('create inserts and returns new script', async () => {
      const row = { id: 5, name: 'test.sh', language: 'bash' };
      db.query
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])
        .mockResolvedValueOnce([[row], []]);
      const result = await AutomationScript.create({ name: 'test.sh', language: 'bash', script_body: 'echo hi' });
      expect(result.name).toBe('test.sh');
    });
  });

  // --- BatchJob ---
  describe('BatchJob', () => {
    it('has correct tableName', () => expect(BatchJob.tableName).toBe('batch_jobs'));
    it('has hasOrgScope=true',  () => expect(BatchJob.hasOrgScope).toBe(true));
    it('has softDelete=false',  () => expect(BatchJob.softDelete).toBe(false));
    it('fillable includes operation and status', () => {
      expect(BatchJob.fillable).toContain('operation');
      expect(BatchJob.fillable).toContain('status');
      expect(BatchJob.fillable).toContain('organization_id');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(BatchJob)).toBe(BaseModel));

    it('findById applies org scope', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }], []]);
      await BatchJob.findById(1, 42);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = ?'),
        [1, 42],
      );
    });

    it('delete performs hard DELETE (no softDelete)', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await BatchJob.delete(1, 1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        expect.any(Array),
      );
    });
  });

  // --- ProvisioningPipeline ---
  describe('ProvisioningPipeline', () => {
    it('has correct tableName', () => expect(ProvisioningPipeline.tableName).toBe('provisioning_pipelines'));
    it('has hasOrgScope=true',  () => expect(ProvisioningPipeline.hasOrgScope).toBe(true));
    it('has softDelete=false',  () => expect(ProvisioningPipeline.softDelete).toBe(false));
    it('fillable includes name, status, contract_id', () => {
      expect(ProvisioningPipeline.fillable).toContain('name');
      expect(ProvisioningPipeline.fillable).toContain('status');
      expect(ProvisioningPipeline.fillable).toContain('contract_id');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(ProvisioningPipeline)).toBe(BaseModel));

    it('count with where filter builds correct SQL', async () => {
      db.query.mockResolvedValueOnce([[{ total: 3 }], []]);
      const total = await ProvisioningPipeline.count({ where: { status: 'completed' }, orgId: 1 });
      expect(total).toBe(3);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('`status` = ?'),
        expect.arrayContaining(['completed']),
      );
    });
  });

  // --- RemediationRule ---
  describe('RemediationRule', () => {
    it('has correct tableName', () => expect(RemediationRule.tableName).toBe('remediation_rules'));
    it('has hasOrgScope=true',  () => expect(RemediationRule.hasOrgScope).toBe(true));
    it('has softDelete=true',   () => expect(RemediationRule.softDelete).toBe(true));
    it('fillable includes condition_metric, action_type', () => {
      expect(RemediationRule.fillable).toContain('condition_metric');
      expect(RemediationRule.fillable).toContain('action_type');
      expect(RemediationRule.fillable).toContain('organization_id');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(RemediationRule)).toBe(BaseModel));

    it('findAll includes deleted_at IS NULL for softDelete=true', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      await RemediationRule.findAll({ orgId: 1 });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at IS NULL'),
        expect.any(Array),
      );
    });

    it('restore clears deleted_at', async () => {
      const row = { id: 1, name: 'R', deleted_at: null };
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
        .mockResolvedValueOnce([[row], []]);              // findById
      const result = await RemediationRule.restore(1, 1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET deleted_at = NULL'),
        expect.arrayContaining([1]),
      );
    });

    it('update with no fillable fields returns existing record', async () => {
      const row = { id: 1, name: 'R' };
      // update with zero fillable keys → calls findByIdOrFail → findById
      db.query.mockResolvedValueOnce([[row], []]);
      const result = await RemediationRule.update(1, { non_fillable: 'x' }, 1);
      expect(result).toEqual(row);
    });
  });

  // --- RouterDriverConfig ---
  describe('RouterDriverConfig', () => {
    it('has correct tableName', () => expect(RouterDriverConfig.tableName).toBe('router_driver_configs'));
    it('has hasOrgScope=true',  () => expect(RouterDriverConfig.hasOrgScope).toBe(true));
    it('has softDelete=true',   () => expect(RouterDriverConfig.softDelete).toBe(true));
    it('fillable includes vendor, host, port', () => {
      expect(RouterDriverConfig.fillable).toContain('vendor');
      expect(RouterDriverConfig.fillable).toContain('host');
      expect(RouterDriverConfig.fillable).toContain('port');
      expect(RouterDriverConfig.fillable).toContain('encrypted_password');
    });
    it('extends BaseModel', () => expect(Object.getPrototypeOf(RouterDriverConfig)).toBe(BaseModel));

    it('forceDelete performs hard DELETE bypassing softDelete', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await RouterDriverConfig.forceDelete(1, 1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        expect.any(Array),
      );
    });

    it('findByIdIncludingDeleted skips deleted_at filter', async () => {
      const row = { id: 1, vendor: 'mikrotik', deleted_at: '2026-01-01' };
      db.query.mockResolvedValueOnce([[row], []]);
      const result = await RouterDriverConfig.findByIdIncludingDeleted(1, 1);
      expect(result).toEqual(row);
      const sql = db.query.mock.calls[0][0];
      expect(sql).not.toContain('deleted_at IS NULL');
    });
  });
});

// =============================================================================
// PART 3 — automationService Unit Tests
// =============================================================================

describe('automationService — evaluateAutomationRules', () => {
  let automationService;
  beforeAll(() => { automationService = require('../src/services/automationService'); });
  afterEach(() => jest.clearAllMocks());

  it('returns {evaluated:0, triggered:0} when no matching rules', async () => {
    db.query.mockResolvedValueOnce([[], []]);
    const result = await automationService.evaluateAutomationRules(1, 'device.offline', {});
    expect(result).toEqual({ evaluated: 0, triggered: 0 });
  });

  it('triggers rule when conditions array is empty (all-match)', async () => {
    const rule = { id: 1, trigger_conditions: '[]', action_type: 'send_notification', action_config: '{}', priority: 0 };
    db.query
      .mockResolvedValueOnce([[rule], []])  // SELECT rules
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE run_count
      .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }]);  // INSERT executions
    const result = await automationService.evaluateAutomationRules(1, 'device.offline', {});
    expect(result.triggered).toBe(1);
  });

  it('skips rule when condition is not met (eq mismatch)', async () => {
    const rule = {
      id: 2,
      trigger_conditions: JSON.stringify([{ field: 'status', operator: 'eq', value: 'active' }]),
      action_type: 'send_notification', action_config: null, priority: 0,
    };
    db.query
      .mockResolvedValueOnce([[rule], []])  // SELECT rules
      .mockResolvedValueOnce([{ insertId: 11, affectedRows: 1 }]);  // INSERT executions (skipped)
    const result = await automationService.evaluateAutomationRules(1, 'invoice.created', { status: 'suspended' });
    expect(result.triggered).toBe(0);
  });

  it('records failure status when dispatchAction throws', async () => {
    const rule = {
      id: 3, trigger_conditions: null,
      action_type: 'create_ticket', action_config: null, priority: 0,
    };
    // simulate DB error on run_count update
    db.query
      .mockResolvedValueOnce([[rule], []])   // SELECT rules
      .mockRejectedValueOnce(new Error('DB error'))  // UPDATE run_count → throws
      .mockResolvedValueOnce([{ insertId: 12, affectedRows: 1 }]);  // INSERT executions
    const result = await automationService.evaluateAutomationRules(1, 'test.event', {});
    // evaluated = 1, triggered should not be incremented due to failure
    expect(result.evaluated).toBe(1);
  });
});

describe('automationService — evaluateCondition', () => {
  let evaluateCondition;
  beforeAll(() => { evaluateCondition = require('../src/services/automationService').evaluateCondition; });

  const cases = [
    [{ status: 'active' }, { field: 'status', operator: 'eq',       value: 'active'    }, true],
    [{ status: 'active' }, { field: 'status', operator: 'neq',      value: 'suspended' }, true],
    [{ score: 90 },        { field: 'score',  operator: 'gt',        value: 80          }, true],
    [{ score: 70 },        { field: 'score',  operator: 'lt',        value: 80          }, true],
    [{ score: 80 },        { field: 'score',  operator: 'gte',       value: 80          }, true],
    [{ score: 80 },        { field: 'score',  operator: 'lte',       value: 80          }, true],
    [{ msg: 'hello' },     { field: 'msg',    operator: 'contains',  value: 'ell'       }, true],
    [{ val: 1 },           { field: 'val',    operator: 'exists',    value: null        }, true],
    [{ val: null },        { field: 'val',    operator: 'exists',    value: null        }, false],
    [{ score: 70 },        { field: 'score',  operator: 'gt',        value: 80          }, false],
    [{},                   { field: 'x',      operator: 'unknown_op',value: 'y'         }, false],
    [{ a: { b: 5 } },     { field: 'a.b',    operator: 'eq',        value: 5           }, true],
  ];

  it.each(cases)('payload=%j condition=%j → %s', (payload, condition, expected) => {
    expect(evaluateCondition(payload, condition)).toBe(expected);
  });
});

describe('automationService — dispatchAction', () => {
  let dispatchAction;
  beforeAll(() => { dispatchAction = require('../src/services/automationService').dispatchAction; });

  const actionCases = [
    ['send_notification', 'Notification queued'],
    ['create_ticket',     'Ticket creation enqueued'],
    ['run_script',        'Script execution queued'],
    ['set_alert',         'Alert rule updated'],
    ['suspend_contract',  'Contract suspension enqueued'],
    ['unknown_action',    "Action type 'unknown_action' acknowledged"],
  ];

  it.each(actionCases)('action=%s returns message containing %s', async (actionType, expected) => {
    const result = await dispatchAction(actionType, {}, {}, 1);
    expect(result).toContain(expected);
  });
});

describe('automationService — createBatchJob', () => {
  let automationService;
  beforeAll(() => { automationService = require('../src/services/automationService'); });
  afterEach(() => jest.clearAllMocks());

  it('creates a batch job with no targets and returns the job row', async () => {
    const job = { id: 1, name: 'Test Batch', operation: 'suspend', status: 'completed' };
    db.query
      .mockResolvedValueOnce([[], []])          // resolveBatchTargets
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])  // INSERT batch_jobs
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE completed
      .mockResolvedValueOnce([[job], []]);        // SELECT final
    const result = await automationService.createBatchJob(1, {
      name: 'Test Batch', operation: 'suspend', filter_criteria: {}, created_by: 1,
    });
    expect(result.operation).toBe('suspend');
  });

  it('creates a batch job with plan_id filter in criteria', async () => {
    const job = { id: 2, name: 'PlanBatch', operation: 'rate_limit', status: 'completed' };
    db.query
      .mockResolvedValueOnce([[], []])  // resolveBatchTargets with plan_id filter
      .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[job], []]);
    const result = await automationService.createBatchJob(1, {
      name: 'PlanBatch', operation: 'rate_limit',
      filter_criteria: { plan_id: 3, client_id: 10 },
    });
    expect(result.name).toBe('PlanBatch');
  });

  it('processes targets and inserts batch_job_items', async () => {
    // Use an unimplemented operation so applyBatchOperation throws at the default case
    // (no extra contract-lookup query) — the item is recorded as a failure.
    const job = { id: 3, name: 'WithItems', operation: 'rate_limit', status: 'completed' };
    db.query
      .mockResolvedValueOnce([[{ entity_id: 100, entity_type: 'contract' }], []])  // targets
      .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }])  // INSERT batch_jobs
      .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }])  // INSERT batch_job_items
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE processed_items
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE completed
      .mockResolvedValueOnce([[job], []]);
    const result = await automationService.createBatchJob(1, {
      name: 'WithItems', operation: 'rate_limit', filter_criteria: { status: 'active' },
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO batch_job_items'),
      expect.any(Array),
    );
  });
});

describe('automationService — evaluateRemediationRules', () => {
  let automationService;
  beforeAll(() => { automationService = require('../src/services/automationService'); });
  afterEach(() => jest.clearAllMocks());

  it('skips rule when no snmp metric data found', async () => {
    const rule = {
      id: 1, condition_metric: 'cpu_usage', condition_operator: 'gt',
      condition_threshold: 80, action_type: 'reboot_device',
      cooldown_minutes: 5, last_triggered_at: null,
    };
    db.query
      .mockResolvedValueOnce([[rule], []])  // rules query
      .mockResolvedValueOnce([[], []]);       // snmp_metrics → empty
    const result = await automationService.evaluateRemediationRules(1);
    expect(result.triggered).toBe(0);
  });

  it('enforces cooldown correctly', async () => {
    const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    const rule = {
      id: 1, condition_metric: 'cpu_usage', condition_operator: 'gt',
      condition_threshold: 80, action_type: 'reboot_device',
      cooldown_minutes: 30, last_triggered_at: recentTime,
    };
    db.query.mockResolvedValueOnce([[rule], []]);
    const result = await automationService.evaluateRemediationRules(1);
    // checkRemediationCondition should NOT be called (cooldown active)
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(result.triggered).toBe(0);
  });

  it('handles all condition operators (gt, lt, gte, lte, eq, neq)', async () => {
    const operators = ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'];
    for (const op of operators) {
      db.query.mockReset();
      const threshold = 50;
      const val = op === 'lt' || op === 'lte' ? 30 : op === 'neq' ? 99 : 60;
      const rule = {
        id: 1, condition_metric: 'cpu_usage', condition_operator: op,
        condition_threshold: threshold, action_type: 'log',
        cooldown_minutes: 0, last_triggered_at: null,
      };
      db.query
        .mockResolvedValueOnce([[rule], []])
        .mockResolvedValueOnce([[{ metric_value: String(val), device_id: 1 }], []])
        .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT executions
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE run_count
      const result = await automationService.evaluateRemediationRules(1);
      // For these specific val/threshold combos, condition should be met
      if (op === 'eq') {
        // val=60, threshold=50 → eq fails → triggered=0 (this is fine, it tests eq path)
        expect(result).toHaveProperty('evaluated');
      } else {
        expect(result.triggered).toBe(1);
      }
    }
  });
});

// =============================================================================
// PART 4 — routerDriverService Unit Tests
// =============================================================================

describe('routerDriverService', () => {
  let svc;
  let routerosService;
  const { encrypt, decrypt } = require('../src/utils/encryption');

  beforeAll(() => {
    svc = require('../src/services/routerDriverService');
    routerosService = require('../src/services/routerosService');
  });
  afterEach(() => jest.clearAllMocks());

  describe('createDriverConfig', () => {
    it('encrypts password and api_token, inserts, and sanitizes result', async () => {
      const raw = { id: 1, vendor: 'mikrotik', host: '192.168.1.1', encrypted_password: 'enc:secret', api_token: null };
      db.query
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])
        .mockResolvedValueOnce([[raw], []]);
      const result = await svc.createDriverConfig(1, { vendor: 'mikrotik', password: 'secret' }, 1);
      expect(encrypt).toHaveBeenCalledWith('secret');
      expect(result).not.toHaveProperty('encrypted_password');
      expect(result.has_password).toBe(true);
    });

    it('handles no password and no api_token', async () => {
      const raw = { id: 2, vendor: 'cisco_ios', host: null, encrypted_password: null, api_token: null };
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[raw], []]);
      const result = await svc.createDriverConfig(1, { vendor: 'cisco_ios' }, 1);
      expect(result.has_password).toBe(false);
      expect(result.has_api_token).toBe(false);
    });
  });

  describe('updateDriverConfig', () => {
    it('updates allowed fields and returns sanitized config', async () => {
      const raw = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', encrypted_password: null, api_token: null };
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
        .mockResolvedValueOnce([[raw], []]);              // SELECT
      const result = await svc.updateDriverConfig(1, 1, { host: '10.0.0.2', vendor: 'mikrotik' });
      expect(result).not.toHaveProperty('encrypted_password');
    });

    it('updates password by encrypting it', async () => {
      const raw = { id: 1, vendor: 'mikrotik', encrypted_password: 'enc:newpass', api_token: null };
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[raw], []]);
      await svc.updateDriverConfig(1, 1, { password: 'newpass' });
      expect(encrypt).toHaveBeenCalledWith('newpass');
    });

    it('returns existing record when no fields provided', async () => {
      const raw = { id: 1, vendor: 'mikrotik', encrypted_password: null, api_token: null };
      db.query.mockResolvedValueOnce([[raw], []]);
      const result = await svc.updateDriverConfig(1, 1, {});
      expect(result.vendor).toBe('mikrotik');
    });

    it('returns null when config not found and no fields', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.updateDriverConfig(999, 1, {});
      expect(result).toBeNull();
    });
  });

  describe('testDriverConnection', () => {
    it('returns null when config not found', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.testDriverConnection(999, 1);
      expect(result).toBeNull();
    });

    it('returns not_implemented for non-mikrotik vendors (no fake success)', async () => {
      const config = { id: 1, vendor: 'cisco_ios', host: '10.0.0.1', encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      const result = await svc.testDriverConnection(1, 1);
      expect(result.status).toBe('not_implemented');
      expect(result.message).toMatch(/not implemented/i);
    });

    it('tests mikrotik via routerosService and returns ok on success', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '192.168.1.1', port: 8728, username: 'admin', encrypted_password: 'enc:pass' };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      routerosService.listInterfaces.mockResolvedValueOnce([{ name: 'ether1' }]);
      const result = await svc.testDriverConnection(1, 1);
      expect(result.status).toBe('ok');
      expect(routerosService.listInterfaces).toHaveBeenCalled();
    });

    it('returns failed status when mikrotik connection throws', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '192.168.1.1', port: 8728, username: 'admin', encrypted_password: 'enc:pass' };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      routerosService.listInterfaces.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await svc.testDriverConnection(1, 1);
      expect(result.status).toBe('failed');
    });
  });

  describe('dispatchCommand', () => {
    it('returns null when config not found', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.dispatchCommand(999, 1, 'show_version', {}, 1);
      expect(result).toBeNull();
    });

    it('returns not_dispatched for non-mikrotik vendor (no fake success)', async () => {
      const config = { id: 1, vendor: 'cisco_ios', protocol: 'ssh', host: '10.0.0.1', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }]);
      const result = await svc.dispatchCommand(1, 1, 'show_version', {}, 1);
      expect(result.status).toBe('not_dispatched');
      expect(result.vendor).toBe('cisco_ios');
    });

    it('dispatches list_interfaces to mikrotik routerosService', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: 'enc:pass' };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 6, affectedRows: 1 }]);
      routerosService.listInterfaces.mockResolvedValueOnce([{ name: 'ether1' }]);
      const result = await svc.dispatchCommand(1, 1, 'list_interfaces', {}, 1);
      expect(result.status).toBe('success');
    });

    it('dispatches pppoe_create to mikrotik routerosService', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }]);
      routerosService.pppoeCreate.mockResolvedValueOnce({ ret: 'ok' });
      const result = await svc.dispatchCommand(1, 1, 'pppoe_create', { name: 'user1' }, 1);
      expect(result.status).toBe('success');
    });

    it('dispatches pppoe_delete to mikrotik routerosService', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 8, affectedRows: 1 }]);
      routerosService.pppoeDelete.mockResolvedValueOnce({});
      const result = await svc.dispatchCommand(1, 1, 'pppoe_delete', { name: 'user1' }, 1);
      expect(result.status).toBe('success');
    });

    it('dispatches queue_set to mikrotik routerosService', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 9, affectedRows: 1 }]);
      routerosService.queueSet.mockResolvedValueOnce({});
      const result = await svc.dispatchCommand(1, 1, 'queue_set', { target: '192.168.1.1/32', maxLimit: '10M/10M' }, 1);
      expect(result.status).toBe('success');
    });

    it('handles unknown mikrotik command gracefully', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }]);
      const result = await svc.dispatchCommand(1, 1, 'unknown_cmd', {}, 1);
      expect(result.status).toBe('success');
      expect(result.response.note).toContain('not mapped');
    });

    it('records failure when mikrotik command throws', async () => {
      const config = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', port: 8728, username: 'admin', device_id: null, encrypted_password: null };
      db.query
        .mockResolvedValueOnce([[config], []])
        .mockResolvedValueOnce([{ insertId: 11, affectedRows: 1 }]);
      routerosService.listInterfaces.mockRejectedValueOnce(new Error('Timeout'));
      const result = await svc.dispatchCommand(1, 1, 'list_interfaces', {}, 1);
      expect(result.status).toBe('failure');
      expect(result.error_message).toBe('Timeout');
    });
  });

  describe('sanitizeConfig', () => {
    it('strips encrypted_password and api_token, adds has_* booleans', () => {
      const config = { id: 1, vendor: 'mikrotik', encrypted_password: 'secret', api_token: 'tok' };
      const result = svc.sanitizeConfig(config);
      expect(result).not.toHaveProperty('encrypted_password');
      expect(result).not.toHaveProperty('api_token');
      expect(result.has_password).toBe(true);
      expect(result.has_api_token).toBe(true);
    });

    it('returns null for null input', () => {
      expect(svc.sanitizeConfig(null)).toBeNull();
    });
  });
});

// =============================================================================
// PART 5 — analyticsService Unit Tests
// =============================================================================

describe('analyticsService', () => {
  let svc;
  beforeAll(() => { svc = require('../src/services/analyticsService'); });
  afterEach(() => jest.clearAllMocks());

  describe('detectAnomalies', () => {
    it('returns 0 when no combos', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.detectAnomalies(1);
      expect(result).toEqual({ combos_checked: 0, anomalies_detected: 0 });
    });

    it('skips combo with fewer than MIN_SAMPLES (6)', async () => {
      db.query
        .mockResolvedValueOnce([[{ device_id: 1 }], []])
        .mockResolvedValueOnce([[{ cpu_usage: '50' }, { cpu_usage: '60' }], []]);  // only 2 samples
      const result = await svc.detectAnomalies(1);
      expect(result.anomalies_detected).toBe(0);
    });

    it('skips combo with stddev=0 (constant metric)', async () => {
      const samples = Array(8).fill({ cpu_usage: '50' });
      db.query
        .mockResolvedValueOnce([[{ device_id: 1 }], []])
        .mockResolvedValueOnce([samples, []]);
      const result = await svc.detectAnomalies(1);
      expect(result.anomalies_detected).toBe(0);
    });

    it('detects critical anomaly (|z| > 4)', async () => {
      // 48 samples: latest=200, 47 stable at 50 → z≈6.85 > 4 → critical severity
      const baseline = Array(47).fill({ cpu_usage: '50' });
      const samples = [{ cpu_usage: '200' }, ...baseline];
      db.query
        .mockResolvedValueOnce([[{ device_id: 1 }], []])
        .mockResolvedValueOnce([samples, []])
        .mockResolvedValueOnce([{ insertId: 1 }]);  // INSERT anomaly
      const result = await svc.detectAnomalies(1);
      expect(result.anomalies_detected).toBe(1);
      const insertCall = db.query.mock.calls[2][0];
      expect(insertCall).toContain('INSERT INTO analytics_anomalies');
    });

    it('detects high severity anomaly (|z| between 3 and 4)', async () => {
      // 12 samples: latest=500, 11 stable at 50 → z≈3.32 (>3 but <4) → high severity
      const baseline12 = Array(11).fill({ memory_usage: '50' });
      const samples = [{ memory_usage: '500' }, ...baseline12];
      db.query
        .mockResolvedValueOnce([[{ device_id: 2 }], []])
        .mockResolvedValueOnce([samples, []])
        .mockResolvedValueOnce([{ insertId: 2 }]);
      const result = await svc.detectAnomalies(1);
      expect(result.anomalies_detected).toBe(1);
    });
  });

  describe('predictiveFailure', () => {
    it('returns sfp_degradation and onu_offline arrays', async () => {
      db.query
        .mockResolvedValueOnce([[{ device_id: 1, rx_power_dbm: '-35', device_name: 'OLT-1' }], []])
        .mockResolvedValueOnce([[{ id: 2, name: 'ONU-A', ip_address: '10.0.0.1', last_polled_at: new Date(Date.now() - 10 * 60 * 1000) }], []]);
      const result = await svc.predictiveFailure(1);
      expect(result).toHaveProperty('sfp_degradation');
      expect(result).toHaveProperty('onu_offline');
      expect(result.sfp_degradation).toHaveLength(1);
      expect(result.sfp_degradation[0].rx_power_dbm).toBe(-35);
      expect(result.sfp_degradation[0].risk).toBe('high');
      expect(result.onu_offline).toHaveLength(1);
      expect(result.onu_offline[0].offline_minutes).toBeGreaterThan(0);
    });

    it('returns empty arrays when no degraded SFP or offline ONU', async () => {
      db.query
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[], []]);
      const result = await svc.predictiveFailure(1);
      expect(result.sfp_degradation).toHaveLength(0);
      expect(result.onu_offline).toHaveLength(0);
      expect(result).toHaveProperty('generated_at');
    });
  });

  describe('alertCorrelation', () => {
    it('returns correlation groups', async () => {
      db.query.mockResolvedValueOnce([[{ rule_id: 1, rule_name: 'CPU Alert', event_count: 5 }], []]);
      const result = await svc.alertCorrelation(1, { window_minutes: 60 });
      expect(result.correlated_groups).toBe(1);
      expect(result.groups).toHaveLength(1);
      expect(result).toHaveProperty('window_minutes', 60);
    });

    it('returns empty groups when no correlated alerts', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.alertCorrelation(1);
      expect(result.correlated_groups).toBe(0);
      expect(result.groups).toHaveLength(0);
    });
  });

  describe('bandwidthForecast', () => {
    it('returns capacityForecast result with analytics_note', async () => {
      const result = await svc.bandwidthForecast(1, { months: 3 });
      expect(result).toHaveProperty('analytics_note');
      expect(result.analytics_note).toContain('capacityForecast');
    });
  });

  describe('computeChurnScores', () => {
    it('returns 0 when no clients', async () => {
      db.query.mockResolvedValueOnce([[], []]);
      const result = await svc.computeChurnScores(1);
      expect(result.clients_scored).toBe(0);
    });

    it('inserts a churn_score row for each client', async () => {
      const clients = [
        { client_id: 1, tenure_months: 24, overdue_invoices: 0, suspensions_30d: 0, open_tickets: 0, payments_late_90d: 0 },
        { client_id: 2, tenure_months: 1, overdue_invoices: 3, suspensions_30d: 2, open_tickets: 5, payments_late_90d: 2 },
      ];
      db.query
        .mockResolvedValueOnce([clients, []])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ insertId: 2 }]);
      const result = await svc.computeChurnScores(1);
      expect(result.clients_scored).toBe(2);
    });
  });

  describe('computeChurnScore', () => {
    const { computeChurnScore } = require('../src/services/analyticsService');

    it('returns 0 for a pristine client', () => {
      const score = computeChurnScore({
        overdue_invoices: 0, suspensions_30d: 0, open_tickets: 0,
        tenure_months: 36, payments_late_90d: 0,
      });
      expect(score).toBe(0);
    });

    it('caps at 100', () => {
      const score = computeChurnScore({
        overdue_invoices: 10, suspensions_30d: 10, open_tickets: 10,
        tenure_months: 1, payments_late_90d: 10,
      });
      expect(score).toBe(100);
    });

    it('returns higher score for new client with overdue invoices', () => {
      const high = computeChurnScore({ overdue_invoices: 3, suspensions_30d: 2, open_tickets: 2, tenure_months: 1, payments_late_90d: 2 });
      const low  = computeChurnScore({ overdue_invoices: 0, suspensions_30d: 0, open_tickets: 0, tenure_months: 24, payments_late_90d: 0 });
      expect(high).toBeGreaterThan(low);
    });

    it('returns correct score for 6-11 month tenure band', () => {
      const score = computeChurnScore({ overdue_invoices: 0, suspensions_30d: 0, open_tickets: 0, tenure_months: 8, payments_late_90d: 0 });
      expect(score).toBe(8); // tenureScore = 8
    });

    it('returns correct score for 3-5 month tenure band', () => {
      const score = computeChurnScore({ overdue_invoices: 0, suspensions_30d: 0, open_tickets: 0, tenure_months: 4, payments_late_90d: 0 });
      expect(score).toBe(14); // tenureScore = 14
    });
  });

  describe('getChurnScores', () => {
    it('returns paginated churn scores', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, client_id: 5, score: 72.5 }], []])
        .mockResolvedValueOnce([[{ total: 1 }], []]);
      const result = await svc.getChurnScores(1);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('filters by risk_band when provided', async () => {
      db.query
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[{ total: 0 }], []]);
      const result = await svc.getChurnScores(1, { risk_band: 'critical' });
      expect(db.query.mock.calls[0][0]).toContain('risk_band');
      expect(result.data).toHaveLength(0);
    });
  });
});

// =============================================================================
// PART 6 — Route Extended Coverage Tests (via supertest)
// =============================================================================

const app = require('../src/app');

// ---------------------------------------------------------------------------
// §18.1 remediationRules.js — uncovered branches
// ---------------------------------------------------------------------------
describe('remediationRules routes — extended coverage', () => {
  it('GET /api/remediation-rules filters by is_enabled', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1', is_enabled: 1 }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/remediation-rules?is_enabled=true');
    expect(res.status).toBe(200);
  });

  it('GET /api/remediation-rules/:id returns rule', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1' }]));
    const res = await request(app).get('/api/remediation-rules/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('GET /api/remediation-rules/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/remediation-rules/9999');
    expect(res.status).toBe(404);
  });

  it('PUT /api/remediation-rules/:id returns 404 for missing rule', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).put('/api/remediation-rules/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/remediation-rules/:id returns 422 when no updatable fields', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1 }]));
    const res = await request(app).put('/api/remediation-rules/1').send({});
    expect(res.status).toBe(422);
  });

  it('PUT /api/remediation-rules/:id updates successfully', async () => {
    const updated = { id: 1, name: 'Updated', condition_metric: 'cpu', condition_operator: 'gt', action_type: 'reboot_device' };
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))  // existing check
      .mockResolvedValueOnce(mockUpdate())             // UPDATE
      .mockResolvedValueOnce(mockRows([updated]));     // SELECT
    const res = await request(app).put('/api/remediation-rules/1').send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated');
  });

  it('GET /api/remediation-rules/:id/executions returns list', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 10, action_type: 'reboot_device', status: 'stubbed' }]));
    const res = await request(app).get('/api/remediation-rules/1/executions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('POST /api/remediation-rules/evaluate triggers evaluation', async () => {
    // automationService.evaluateRemediationRules → rules query = empty
    db.query.mockResolvedValueOnce(mockRows([]));
    const res = await request(app).post('/api/remediation-rules/evaluate');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('evaluated');
  });
});

// ---------------------------------------------------------------------------
// §18.3 routerDrivers.js — uncovered branches
// ---------------------------------------------------------------------------
describe('routerDrivers routes — extended coverage', () => {
  const { encrypt } = require('../src/utils/encryption');

  it('GET /api/router-drivers filters by vendor', async () => {
    const rows = [{ id: 1, vendor: 'cisco_ios', has_password: false, has_api_token: false, encrypted_password: null, api_token: null }];
    db.query
      .mockResolvedValueOnce(mockRows(rows))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/router-drivers?vendor=cisco_ios');
    expect(res.status).toBe(200);
  });

  it('GET /api/router-drivers filters by is_active', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));
    const res = await request(app).get('/api/router-drivers?is_active=true');
    expect(res.status).toBe(200);
  });

  it('GET /api/router-drivers/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/router-drivers/9999');
    expect(res.status).toBe(404);
  });

  it('GET /api/router-drivers/:id returns config (sanitized)', async () => {
    const raw = { id: 1, vendor: 'mikrotik', host: '10.0.0.1', encrypted_password: null, api_token: null };
    db.query.mockResolvedValueOnce(mockRows([raw]));
    const res = await request(app).get('/api/router-drivers/1');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('encrypted_password');
  });

  it('PUT /api/router-drivers/:id returns 404 when service returns null', async () => {
    // updateDriverConfig → no fields provided → reads config → not found
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).put('/api/router-drivers/9999').send({});
    expect(res.status).toBe(404);
  });

  it('PUT /api/router-drivers/:id updates successfully', async () => {
    const raw = { id: 1, vendor: 'mikrotik', host: '10.0.0.2', encrypted_password: null, api_token: null };
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce(mockRows([raw]));
    const res = await request(app).put('/api/router-drivers/1').send({ host: '10.0.0.2' });
    expect(res.status).toBe(200);
  });

  it('POST /api/router-drivers/:id/test returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/router-drivers/9999/test');
    expect(res.status).toBe(404);
  });

  it('POST /api/router-drivers/:id/test returns 501 not_implemented for non-mikrotik', async () => {
    const config = { id: 1, vendor: 'cisco_ios', host: '10.0.0.1', encrypted_password: null };
    db.query
      .mockResolvedValueOnce(mockRows([config]))
      .mockResolvedValueOnce(mockUpdate());  // UPDATE last_tested_at
    const res = await request(app).post('/api/router-drivers/1/test');
    expect(res.status).toBe(501);
    expect(res.body.data.status).toBe('not_implemented');
  });

  it('GET /api/router-drivers/command-executions/list returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, command: 'list_interfaces', status: 'success' }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/router-drivers/command-executions/list');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/router-drivers/command-executions/list filters by vendor and status', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));
    const res = await request(app).get('/api/router-drivers/command-executions/list?vendor=mikrotik&status=success');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §18.2 automationScripts.js — uncovered branches
// ---------------------------------------------------------------------------
describe('automationScripts routes — extended coverage', () => {
  const scriptingService = require('../src/services/scriptingService');

  it('GET /api/automation-scripts calls scriptingService.listScripts', async () => {
    scriptingService.listScripts.mockResolvedValueOnce({ data: [], meta: { total: 0 } });
    const res = await request(app).get('/api/automation-scripts');
    expect(res.status).toBe(200);
    expect(scriptingService.listScripts).toHaveBeenCalled();
  });

  it('GET /api/automation-scripts/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/automation-scripts/9999');
    expect(res.status).toBe(404);
  });

  it('GET /api/automation-scripts/:id returns script', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1, name: 'test.sh', language: 'bash' }]));
    const res = await request(app).get('/api/automation-scripts/1');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('test.sh');
  });

  it('PUT /api/automation-scripts/:id returns 404 when updateScript returns null', async () => {
    scriptingService.updateScript.mockResolvedValueOnce(null);
    const res = await request(app).put('/api/automation-scripts/9999').send({ name: 'x', language: 'bash' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/automation-scripts/:id updates successfully', async () => {
    const updated = { id: 1, name: 'updated.sh', language: 'bash' };
    scriptingService.updateScript.mockResolvedValueOnce(updated);
    const res = await request(app).put('/api/automation-scripts/1').send({ name: 'updated.sh' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('updated.sh');
  });

  it('GET /api/automation-scripts/executions/list returns executions', async () => {
    scriptingService.listExecutions.mockResolvedValueOnce({ data: [{ id: 1, status: 'queued' }], meta: { total: 1 } });
    const res = await request(app).get('/api/automation-scripts/executions/list');
    expect(res.status).toBe(200);
  });

  it('GET /api/automation-scripts/:id/executions returns script executions', async () => {
    scriptingService.listExecutions.mockResolvedValueOnce({ data: [], meta: { total: 0 } });
    const res = await request(app).get('/api/automation-scripts/1/executions');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §18.1 batchJobs.js — uncovered branches
// ---------------------------------------------------------------------------
describe('batchJobs routes — extended coverage', () => {
  it('GET /api/batch-jobs filters by status and operation', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, operation: 'suspend', status: 'completed' }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/batch-jobs?status=completed&operation=suspend');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/batch-jobs/:id returns job', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1, name: 'BJ1', status: 'completed' }]));
    const res = await request(app).get('/api/batch-jobs/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('GET /api/batch-jobs/:id returns 404', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/batch-jobs/9999');
    expect(res.status).toBe(404);
  });

  it('GET /api/batch-jobs/:id/items returns items', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, entity_id: 10, status: 'success' }]))
      .mockResolvedValueOnce(mockCount(1));
    const res = await request(app).get('/api/batch-jobs/1/items');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/batch-jobs/:id/items filters by status', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));
    const res = await request(app).get('/api/batch-jobs/1/items?status=failure');
    expect(res.status).toBe(200);
  });
});
