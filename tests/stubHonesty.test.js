// =============================================================================
// FireISP 5.0 — Stub-Honesty Tests (g8)
// Asserts that previously-fake-success stubs now surface honest failure.
//
// db.query() always resolves to [rows, fields] (mysql2 convention).
// =============================================================================

// Mocks must be declared before any require() so Jest hoisting can apply them.
jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn(v => `enc(${v})`),
  decrypt: jest.fn(v => v.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

// suspensionService mocked so automationService tests don't need a real DB
jest.mock('../src/services/suspensionService', () => ({
  suspendContract: jest.fn().mockResolvedValue({}),
  reconnectContract: jest.fn().mockResolvedValue({}),
}));

const db = require('../src/config/database');

// Services are required ONCE after mocks are registered (no resetModules)
const routerDriverService = require('../src/services/routerDriverService');
const integrationService = require('../src/services/integrationService');
const scriptingService = require('../src/services/scriptingService');
const automationService = require('../src/services/automationService');

// Helper: wrap rows in [rows, fields] as mysql2 always returns
const qResult = (rows) => [rows, []];
const insertResult = (id) => [{ insertId: id }, []];
const updateResult = () => [{ affectedRows: 1 }, []];

beforeEach(() => {
  // resetAllMocks clears both call history AND mockResolvedValueOnce queues
  // so no stale mocks from previous tests bleed through.
  jest.resetAllMocks();
  delete process.env.SCRIPT_EXECUTION_ENABLED;
});

afterEach(() => {
  delete process.env.SCRIPT_EXECUTION_ENABLED;
});

// =============================================================================
// routerDriverService
// =============================================================================

describe('routerDriverService', () => {
  describe('testDriverConnection — non-MikroTik vendor', () => {
    test('returns not_implemented status (not ok)', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'cisco_ios', encrypted_password: null }]))
        .mockResolvedValueOnce(updateResult());

      const result = await routerDriverService.testDriverConnection(1, 1);
      expect(result.status).toBe('not_implemented');
      expect(result.message).toMatch(/not implemented/i);
    });

    test('updates last_test_status to not_implemented (not ok)', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'juniper_junos', encrypted_password: null }]))
        .mockResolvedValueOnce(updateResult());

      await routerDriverService.testDriverConnection(1, 1);
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toMatch(/last_test_status/i);
      expect(updateCall[1][0]).toBe('not_implemented');
    });

    test('does not return ok status for non-MikroTik vendors', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'huawei', encrypted_password: null }]))
        .mockResolvedValueOnce(updateResult());

      const result = await routerDriverService.testDriverConnection(1, 1);
      expect(result.status).not.toBe('ok');
    });

    test('returns null for unknown config', async () => {
      db.query.mockResolvedValueOnce(qResult([]));
      const result = await routerDriverService.testDriverConnection(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('dispatchCommand — non-MikroTik vendor', () => {
    test('returns not_dispatched status', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'cisco_ios', device_id: null, protocol: 'ssh', encrypted_password: null }]))
        .mockResolvedValueOnce(insertResult(99));

      const result = await routerDriverService.dispatchCommand(1, 1, 'some_command', {}, null);
      expect(result.status).toBe('not_dispatched');
      expect(result.response).toMatchObject({ dispatched: false });
      expect(result.error_message).toMatch(/not implemented/i);
    });

    test('records execution row with not_dispatched status', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'zte', device_id: null, protocol: 'rest', encrypted_password: null }]))
        .mockResolvedValueOnce(insertResult(42));

      await routerDriverService.dispatchCommand(1, 1, 'ping', {}, null);
      const insertCall = db.query.mock.calls[1];
      // 7th bound param in the INSERT (index 6) is status
      const insertParams = insertCall[1];
      expect(insertParams[6]).toBe('not_dispatched');
    });

    test('does not return success or stubbed status', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{ id: 1, vendor: 'generic_rest', device_id: null, protocol: 'rest', encrypted_password: null }]))
        .mockResolvedValueOnce(insertResult(1));

      const result = await routerDriverService.dispatchCommand(1, 1, 'cmd', {}, null);
      expect(result.status).not.toBe('success');
      expect(result.status).not.toBe('stubbed');
    });
  });
});

// =============================================================================
// integrationService
// =============================================================================

describe('integrationService', () => {
  const mockConnection = {
    id: 1, organization_id: 1, provider_id: 1, name: 'Test', config_json: null,
    status: 'pending', last_synced_at: null, last_error: null, is_enabled: 1,
    created_by: null, created_at: new Date(), updated_at: new Date(),
    provider_key: 'quickbooks', provider_name: 'QuickBooks', category: 'accounting',
    capabilities: '[]',
  };

  describe('testConnection — stubbed provider', () => {
    const setupMocks = () => {
      db.query
        .mockResolvedValueOnce(qResult([mockConnection]))  // getConnection SELECT
        .mockResolvedValueOnce(updateResult())             // UPDATE connection status
        .mockResolvedValueOnce(insertResult(10))           // insertSyncLog INSERT
        .mockResolvedValueOnce(qResult([{ id: 10, status: 'stubbed' }])); // insertSyncLog SELECT
    };

    test('returns status=stubbed (not active/success)', async () => {
      setupMocks();
      const result = await integrationService.testConnection(1, 1);
      expect(result.status).toBe('stubbed');
    });

    test('sets connection status to not_implemented, never active', async () => {
      setupMocks();
      await integrationService.testConnection(1, 1);
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toMatch(/UPDATE integration_connections/i);
      expect(updateCall[1][0]).toBe('not_implemented');
      expect(updateCall[1][0]).not.toBe('active');
    });

    test('never marks connection as active on stub', async () => {
      setupMocks();
      await integrationService.testConnection(1, 1);
      for (const call of db.query.mock.calls) {
        if (typeof call[0] === 'string' && call[0].includes('UPDATE integration_connections')) {
          expect(call[1]).not.toContain('active');
        }
      }
    });
  });

  describe('sync — stubbed provider', () => {
    const setupMocks = () => {
      db.query
        .mockResolvedValueOnce(qResult([mockConnection]))  // getConnection SELECT
        .mockResolvedValueOnce(updateResult())             // UPDATE connection status
        .mockResolvedValueOnce(insertResult(20))           // insertSyncLog INSERT
        .mockResolvedValueOnce(qResult([{ id: 20, status: 'stubbed' }])); // insertSyncLog SELECT
    };

    test('returns status=stubbed (not active/success)', async () => {
      setupMocks();
      const result = await integrationService.sync(1, 1);
      expect(result.status).toBe('stubbed');
    });

    test('sets connection status to not_implemented, never active', async () => {
      setupMocks();
      await integrationService.sync(1, 1, 'outbound');
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toMatch(/UPDATE integration_connections/i);
      // The SQL literal hard-codes 'not_implemented'
      expect(updateCall[0]).toMatch(/not_implemented/);
      expect(updateCall[0]).not.toMatch(/'active'/);
    });
  });

  describe('disabled connection', () => {
    test('testConnection throws 422 for disabled connection', async () => {
      db.query.mockResolvedValueOnce(qResult([{ ...mockConnection, is_enabled: 0 }]));
      await expect(integrationService.testConnection(1, 1)).rejects.toMatchObject({ statusCode: 422 });
    });

    test('sync throws 422 for disabled connection', async () => {
      db.query.mockResolvedValueOnce(qResult([{ ...mockConnection, is_enabled: 0 }]));
      await expect(integrationService.sync(1, 1)).rejects.toMatchObject({ statusCode: 422 });
    });
  });
});

// =============================================================================
// scriptingService.executeScript — must reject when engine not enabled
// =============================================================================

describe('scriptingService.executeScript', () => {
  test('throws with statusCode 501 when SCRIPT_EXECUTION_ENABLED is not set', async () => {
    db.query.mockResolvedValueOnce(qResult([{ id: 1, language: 'bash' }]));

    await expect(scriptingService.executeScript(1, 1, {})).rejects.toMatchObject({
      statusCode: 501,
      code: 'SCRIPT_EXECUTION_NOT_ENABLED',
    });
  });

  test('throws with clear message about execution engine', async () => {
    db.query.mockResolvedValueOnce(qResult([{ id: 1, language: 'python' }]));

    await expect(scriptingService.executeScript(1, 1, {})).rejects.toThrow(/script execution engine is not enabled/i);
  });

  test('does NOT insert a queued row when engine is disabled', async () => {
    db.query.mockResolvedValueOnce(qResult([{ id: 1, language: 'bash' }]));

    try { await scriptingService.executeScript(1, 1, {}); } catch (_err) { /* expected rejection */ }
    // Only one DB call (SELECT to find the script), no INSERT
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('returns null for unknown script regardless of engine flag', async () => {
    db.query.mockResolvedValueOnce(qResult([]));
    const result = await scriptingService.executeScript(999, 1, {});
    expect(result).toBeNull();
  });

  test('queues execution row when SCRIPT_EXECUTION_ENABLED=true', async () => {
    process.env.SCRIPT_EXECUTION_ENABLED = 'true';
    db.query
      .mockResolvedValueOnce(qResult([{ id: 1, language: 'bash' }]))
      .mockResolvedValueOnce(insertResult(5))
      .mockResolvedValueOnce(qResult([{ id: 5, status: 'queued' }]));

    const result = await scriptingService.executeScript(1, 1, { triggered_by: 7 });
    expect(result.status).toBe('queued');
  });
});

// =============================================================================
// automationService
// =============================================================================

describe('automationService', () => {
  describe('unimplemented batch operations produce failure items', () => {
    // createBatchJob call order:
    //   1. resolveBatchTargets SELECT contracts
    //   2. INSERT batch_job
    //   3. INSERT batch_job_items (per target)
    //   4. UPDATE batch_jobs processed_items (per target)
    //   5. final UPDATE batch_jobs
    //   6. SELECT batch_jobs (return value)
    test.each(['send_notification', 'apply_tag', 'remove_tag', 'rate_limit', 'send_email', 'send_sms'])(
      'operation "%s" results in failed batch item',
      async (operation) => {
        db.query
          .mockResolvedValueOnce(qResult([{ entity_id: 10, entity_type: 'contract' }])) // resolveBatchTargets
          .mockResolvedValueOnce(insertResult(1))        // INSERT batch_job
          .mockResolvedValueOnce(insertResult(1))        // INSERT batch_job_items
          .mockResolvedValueOnce(updateResult())         // UPDATE batch_jobs processed_items
          .mockResolvedValueOnce(updateResult())         // final UPDATE batch_jobs
          .mockResolvedValueOnce(qResult([{ id: 1, operation, status: 'completed', failed_items: 1, success_items: 0 }]));

        const job = await automationService.createBatchJob(1, {
          name: 'test', operation, filter_criteria: {}, operation_params: {}, created_by: 1,
        });

        expect(job.failed_items).toBeGreaterThan(0);
        // Verify the item was inserted with 'failure' status
        const itemInsert = db.query.mock.calls.find(c =>
          typeof c[0] === 'string' && c[0].includes('batch_job_items'),
        );
        expect(itemInsert).toBeTruthy();
        expect(itemInsert[1][4]).toBe('failure'); // status is 5th param (index 4)
      },
    );
  });

  describe('provisioning pipeline configure_device stage', () => {
    // configure_device is not implemented. Rather than silently claiming success OR
    // hard-failing every pipeline forever (which would leave the implemented stages —
    // activate_contract, send_notification — permanently unreachable), it records an
    // explicit not-implemented marker in its stage output and the pipeline continues.
    // This test asserts there is NO fake success: the recorded stage output for
    // configure_device must carry { implemented: false }.
    //
    // DB call sequence (contract_id present → activate_contract runs its UPDATE):
    //   1 INSERT pipeline; then per stage: UPDATE current_stage, INSERT stage, [stage work], UPDATE stage;
    //   activate_contract adds one UPDATE contracts; finally UPDATE pipeline + SELECT.
    test('configure_device is recorded as not-implemented, never fake success', async () => {
      db.query
        .mockResolvedValueOnce(insertResult(1))     // INSERT pipeline
        // assign_ip
        .mockResolvedValueOnce(updateResult())      // UPDATE current_stage
        .mockResolvedValueOnce(insertResult(10))    // INSERT stage
        .mockResolvedValueOnce(updateResult())      // UPDATE stage completed
        // configure_device (returns marker, no internal query)
        .mockResolvedValueOnce(updateResult())      // UPDATE current_stage
        .mockResolvedValueOnce(insertResult(11))    // INSERT stage
        .mockResolvedValueOnce(updateResult())      // UPDATE stage completed
        // activate_contract (contract_id=1 → UPDATE contracts)
        .mockResolvedValueOnce(updateResult())      // UPDATE current_stage
        .mockResolvedValueOnce(insertResult(12))    // INSERT stage
        .mockResolvedValueOnce(updateResult())      // UPDATE contracts
        .mockResolvedValueOnce(updateResult())      // UPDATE stage completed
        // send_notification
        .mockResolvedValueOnce(updateResult())      // UPDATE current_stage
        .mockResolvedValueOnce(insertResult(13))    // INSERT stage
        .mockResolvedValueOnce(updateResult())      // UPDATE stage completed
        // final
        .mockResolvedValueOnce(updateResult())      // UPDATE provisioning_pipelines final
        .mockResolvedValueOnce(qResult([{ id: 1, status: 'completed' }])); // SELECT

      await automationService.runProvisioningPipeline(1, {
        name: 'test', contract_id: 1, client_id: 1, triggered_by: 1,
      });

      // The final UPDATE persists stages_results JSON — configure_device must be honest.
      const finalUpdate = db.query.mock.calls.find(c =>
        typeof c[0] === 'string'
        && c[0].includes('UPDATE provisioning_pipelines')
        && c[0].includes('stages_results'),
      );
      expect(finalUpdate).toBeTruthy();
      const stageResults = JSON.parse(finalUpdate[1][1]);
      expect(stageResults.configure_device.output).toMatchObject({ implemented: false });
      // And it must NOT have masqueraded as a configured device.
      expect(stageResults.configure_device.output).not.toHaveProperty('configured', true);
    });
  });

  describe('evaluateRemediationRules — device actions marked not_dispatched', () => {
    test('records executions with not_dispatched status', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{
          id: 1, action_type: 'reboot_device',
          condition_metric: 'cpu_usage', condition_operator: 'gt', condition_threshold: 90,
          cooldown_minutes: 1, last_triggered_at: null, is_enabled: 1, run_count: 0,
        }]))                                                     // SELECT rules
        // checkRemediationCondition now evaluates per-device (item 4 of the
        // second adversarial review) — the query returns device_id +
        // metric_value (+ polled_at, unused here since this rule sets no
        // condition_duration_minutes) per device with a recent reading,
        // instead of one arbitrary org-wide row.
        .mockResolvedValueOnce(qResult([{ device_id: 1, metric_value: '95', polled_at: new Date() }])) // checkCondition
        .mockResolvedValueOnce(insertResult(1))                  // INSERT executions
        .mockResolvedValueOnce(updateResult());                   // UPDATE rules

      await automationService.evaluateRemediationRules(1);

      const insertCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('remediation_executions'),
      );
      expect(insertCall).toBeTruthy();
      // INSERT columns are (organization_id, remediation_rule_id, device_id,
      // action_type, status, result_message, duration_ms) — device_id (item
      // 4: which device actually triggered it) shifted status to index 4.
      expect(insertCall[1][2]).toBe(1); // device_id
      expect(insertCall[1][4]).toBe('not_dispatched');
      expect(insertCall[1][5]).toMatch(/not dispatched/i);
    });

    test('does not record stubbed status for remediation actions', async () => {
      db.query
        .mockResolvedValueOnce(qResult([{
          id: 1, action_type: 'reboot_device',
          condition_metric: 'cpu_usage', condition_operator: 'gt', condition_threshold: 90,
          cooldown_minutes: 1, last_triggered_at: null, is_enabled: 1, run_count: 0,
        }]))
        .mockResolvedValueOnce(qResult([{ device_id: 1, metric_value: '99', polled_at: new Date() }]))
        .mockResolvedValueOnce(insertResult(1))
        .mockResolvedValueOnce(updateResult());

      await automationService.evaluateRemediationRules(1);

      const insertCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('remediation_executions'),
      );
      expect(insertCall).toBeTruthy();
      expect(insertCall[1][4]).not.toBe('stubbed');
    });
  });
});
