// =============================================================================
// FireISP 5.0 — §18 Automation & Scripting Integration Tests
// =============================================================================

const request = require('supertest');

// --- Mocks ---
jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/services/reportService', () => ({
  capacityForecast: jest.fn().mockResolvedValue({ months: 6, data: [], note: 'mock' }),
}));
jest.mock('../src/middleware/auth', () => ({ authenticate: (_req, _res, next) => { _req.user = { id: 1, role: 'admin' }; next(); } }));
jest.mock('../src/middleware/orgScope', () => ({ orgScope: (_req, _res, next) => { _req.orgId = 1; next(); } }));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/rateLimit', () => ({
  apiLimiter: (_req, _res, next) => next(),
  sessionLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
  exportLimiter: (_req, _res, next) => next(),
  sseLimiter: (_req, _res, next) => next(),
  webhookLimiter: (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/checkQuota', () => ({ quotaCheck: () => (_req, _res, next) => next() }));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist: () => [],
}));

const db = require('../src/config/database');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockRow(row) { return [[row], []]; }
function mockRows(rows) { return [rows, []]; }
function mockInsert(id = 1) { return [{ insertId: id, affectedRows: 1 }]; }
function mockUpdate() { return [{ affectedRows: 1 }]; }
function mockEmpty() { return [[], []]; }
function mockCount(n) { return [[{ total: n }], []]; }

beforeEach(() => { db.query.mockReset(); });

// ---------------------------------------------------------------------------
// §18.1 Automation Rules
// ---------------------------------------------------------------------------
describe('GET /api/automation-rules', () => {
  it('returns list with meta', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'Test Rule', trigger_event: 'invoice.created', action_type: 'send_notification' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/automation-rules');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('filters by trigger_event', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));

    const res = await request(app).get('/api/automation-rules?trigger_event=device.offline');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('POST /api/automation-rules', () => {
  it('creates a rule', async () => {
    const newRule = { id: 2, name: 'Offline Alert', trigger_event: 'device.offline', action_type: 'send_notification' };
    db.query
      .mockResolvedValueOnce(mockInsert(2))
      .mockResolvedValueOnce(mockRows([newRule]));

    const res = await request(app).post('/api/automation-rules').send({
      name: 'Offline Alert', trigger_event: 'device.offline', action_type: 'send_notification',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(2);
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app).post('/api/automation-rules').send({ trigger_event: 'x', action_type: 'y' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/automation-rules/:id', () => {
  it('returns 404 for unknown id', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).get('/api/automation-rules/9999');
    expect(res.status).toBe(404);
  });

  it('returns the rule', async () => {
    db.query.mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1', trigger_event: 'e', action_type: 'a' }]));
    const res = await request(app).get('/api/automation-rules/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });
});

describe('PUT /api/automation-rules/:id', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).put('/api/automation-rules/999').send({ name: 'New Name' });
    expect(res.status).toBe(404);
  });

  it('updates and returns rule', async () => {
    const updated = { id: 1, name: 'Updated', trigger_event: 'e', action_type: 'a' };
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate())
      .mockResolvedValueOnce(mockRows([updated]));

    const res = await request(app).put('/api/automation-rules/1').send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated');
  });
});

describe('DELETE /api/automation-rules/:id', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).delete('/api/automation-rules/999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes and returns 204', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate());
    const res = await request(app).delete('/api/automation-rules/1');
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// §18.1 Batch Jobs
// ---------------------------------------------------------------------------
describe('GET /api/batch-jobs', () => {
  it('returns list with meta', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'Batch 1', operation: 'suspend' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/batch-jobs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/batch-jobs', () => {
  it('creates and completes a batch job', async () => {
    const completedJob = { id: 1, name: 'B1', operation: 'suspend', status: 'completed', total_items: 0, success_items: 0, failed_items: 0 };
    db.query
      // resolveBatchTargets: contracts query
      .mockResolvedValueOnce(mockRows([]))
      // INSERT batch_jobs
      .mockResolvedValueOnce(mockInsert(1))
      // UPDATE batch_jobs completed
      .mockResolvedValueOnce(mockUpdate())
      // SELECT batch_jobs final
      .mockResolvedValueOnce(mockRows([completedJob]));

    const res = await request(app).post('/api/batch-jobs').send({
      name: 'B1', operation: 'suspend', filter_criteria: { status: 'active' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('B1');
  });

  it('returns 422 when operation is missing', async () => {
    const res = await request(app).post('/api/batch-jobs').send({ name: 'B1', filter_criteria: {} });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/batch-jobs/:id/cancel', () => {
  it('returns 404 when job not found or not cancellable', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/batch-jobs/999/cancel');
    expect(res.status).toBe(404);
  });

  it('cancels a job', async () => {
    const cancelled = { id: 1, status: 'cancelled' };
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate())
      .mockResolvedValueOnce(mockRows([cancelled]));

    const res = await request(app).post('/api/batch-jobs/1/cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// §18.1 Provisioning Pipelines
// ---------------------------------------------------------------------------
describe('GET /api/provisioning-pipelines', () => {
  it('returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'P1', status: 'completed' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/provisioning-pipelines');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/provisioning-pipelines', () => {
  it('creates and runs a pipeline', async () => {
    const pipelineResult = { id: 1, name: 'New Sub', status: 'completed' };

    // 1 INSERT pipeline + 4 stages × (UPDATE current_stage + INSERT stage + UPDATE stage) + 1 final UPDATE + 1 SELECT
    // activate_contract with null contract_id skips the contracts UPDATE
    db.query
      .mockResolvedValueOnce(mockInsert(1))       // INSERT provisioning_pipelines
      // Stage 0 (assign_ip)
      .mockResolvedValueOnce(mockUpdate())        // UPDATE current_stage
      .mockResolvedValueOnce(mockInsert(10))      // INSERT stage row
      .mockResolvedValueOnce(mockUpdate())        // UPDATE stage completed
      // Stage 1 (configure_device)
      .mockResolvedValueOnce(mockUpdate())        // UPDATE current_stage
      .mockResolvedValueOnce(mockInsert(11))      // INSERT stage row
      .mockResolvedValueOnce(mockUpdate())        // UPDATE stage completed
      // Stage 2 (activate_contract — no contract_id, skips DB UPDATE)
      .mockResolvedValueOnce(mockUpdate())        // UPDATE current_stage
      .mockResolvedValueOnce(mockInsert(12))      // INSERT stage row
      .mockResolvedValueOnce(mockUpdate())        // UPDATE stage completed
      // Stage 3 (send_notification)
      .mockResolvedValueOnce(mockUpdate())        // UPDATE current_stage
      .mockResolvedValueOnce(mockInsert(13))      // INSERT stage row
      .mockResolvedValueOnce(mockUpdate())        // UPDATE stage completed
      // Final
      .mockResolvedValueOnce(mockUpdate())        // UPDATE pipeline completed
      .mockResolvedValueOnce(mockRows([pipelineResult])); // SELECT final

    const res = await request(app).post('/api/provisioning-pipelines').send({
      name: 'New Sub',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('New Sub');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app).post('/api/provisioning-pipelines').send({});
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// §18.1 Remediation Rules
// ---------------------------------------------------------------------------
describe('GET /api/remediation-rules', () => {
  it('returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'R1', condition_metric: 'is_offline', action_type: 'reboot_device' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/remediation-rules');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/remediation-rules', () => {
  it('creates a rule', async () => {
    const newRule = { id: 3, name: 'Reboot ONU', condition_metric: 'is_offline', condition_operator: 'is_true', action_type: 'reboot_device' };
    db.query
      .mockResolvedValueOnce(mockInsert(3))
      .mockResolvedValueOnce(mockRows([newRule]));

    const res = await request(app).post('/api/remediation-rules').send({
      name: 'Reboot ONU', condition_metric: 'is_offline', condition_operator: 'is_true', action_type: 'reboot_device',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Reboot ONU');
  });

  it('returns 422 when required fields missing', async () => {
    const res = await request(app).post('/api/remediation-rules').send({ name: 'X' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/remediation-rules/:id', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).delete('/api/remediation-rules/999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate());
    const res = await request(app).delete('/api/remediation-rules/1');
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// §18.2 Automation Scripts
// ---------------------------------------------------------------------------
describe('GET /api/automation-scripts', () => {
  it('returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, name: 'backup.sh', language: 'bash', is_shared: 0 }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/automation-scripts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/automation-scripts', () => {
  it('creates a script', async () => {
    const newScript = { id: 5, name: 'backup.sh', language: 'bash', is_shared: 0 };
    db.query
      .mockResolvedValueOnce(mockInsert(5))
      .mockResolvedValueOnce(mockRows([newScript]));

    const res = await request(app).post('/api/automation-scripts').send({
      name: 'backup.sh', language: 'bash', script_body: '#!/bin/bash\necho hello',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('backup.sh');
  });

  it('returns 422 when language missing', async () => {
    const res = await request(app).post('/api/automation-scripts').send({ name: 'x', script_body: 'y' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/automation-scripts/:id/execute', () => {
  it('creates a queued execution when the execution engine is enabled', async () => {
    process.env.SCRIPT_EXECUTION_ENABLED = 'true';
    const script = { id: 1, name: 'test.sh', language: 'bash' };
    const execution = { id: 10, script_id: 1, status: 'queued', organization_id: 1 };
    db.query
      .mockResolvedValueOnce(mockRows([script]))
      .mockResolvedValueOnce(mockInsert(10))
      .mockResolvedValueOnce(mockRows([execution]));

    const res = await request(app).post('/api/automation-scripts/1/execute').send({});
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    delete process.env.SCRIPT_EXECUTION_ENABLED;
  });

  it('returns 501 when the execution engine is not enabled', async () => {
    delete process.env.SCRIPT_EXECUTION_ENABLED;
    const script = { id: 1, name: 'test.sh', language: 'bash' };
    db.query.mockResolvedValueOnce(mockRows([script]));
    const res = await request(app).post('/api/automation-scripts/1/execute').send({});
    expect(res.status).toBe(501);
  });

  it('returns 404 for unknown script', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/automation-scripts/999/execute').send({});
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/automation-scripts/:id', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).delete('/api/automation-scripts/999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate());
    const res = await request(app).delete('/api/automation-scripts/1');
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// §18.3 Router Drivers
// ---------------------------------------------------------------------------
describe('GET /api/router-drivers', () => {
  it('returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, vendor: 'mikrotik', host: '10.0.0.1', encrypted_password: null, api_token: null }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/router-drivers');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Encrypted fields stripped
    expect(res.body.data[0].encrypted_password).toBeUndefined();
  });
});

describe('POST /api/router-drivers', () => {
  it('creates a driver config', async () => {
    const config = { id: 7, vendor: 'mikrotik', host: '10.1.1.1', has_password: false, has_api_token: false };
    db.query
      .mockResolvedValueOnce(mockInsert(7))
      .mockResolvedValueOnce(mockRows([{ id: 7, vendor: 'mikrotik', host: '10.1.1.1', encrypted_password: null, api_token: null }]));

    const res = await request(app).post('/api/router-drivers').send({ vendor: 'mikrotik' });
    expect(res.status).toBe(201);
    expect(res.body.data.vendor).toBe('mikrotik');
  });

  it('returns 422 when vendor missing', async () => {
    const res = await request(app).post('/api/router-drivers').send({ host: '1.2.3.4' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/router-drivers/:id', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).delete('/api/router-drivers/999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate());
    const res = await request(app).delete('/api/router-drivers/1');
    expect(res.status).toBe(204);
  });
});

describe('POST /api/router-drivers/:id/dispatch', () => {
  it('returns 501 not_dispatched for non-mikrotik vendor (no fake success)', async () => {
    const config = { id: 1, vendor: 'cisco_ios', protocol: 'ssh', host: '10.0.0.1', device_id: null, encrypted_password: null };
    db.query
      .mockResolvedValueOnce(mockRows([config]))
      .mockResolvedValueOnce(mockInsert(20));

    const res = await request(app).post('/api/router-drivers/1/dispatch').send({ command: 'show_version' });
    expect(res.status).toBe(501);
    expect(res.body.data.status).toBe('not_dispatched');
  });

  it('returns 404 when config not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/router-drivers/999/dispatch').send({ command: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 422 when command missing', async () => {
    const res = await request(app).post('/api/router-drivers/1/dispatch').send({});
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// §18.4 Analytics
// ---------------------------------------------------------------------------
describe('GET /api/analytics/anomalies', () => {
  it('returns list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, metric: 'cpu_usage', severity: 'high' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/analytics/anomalies');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by severity', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockCount(0));

    const res = await request(app).get('/api/analytics/anomalies?severity=critical');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/analytics/anomalies/detect', () => {
  it('runs detection and returns counts', async () => {
    // combos query
    db.query.mockResolvedValueOnce(mockRows([]));

    const res = await request(app).post('/api/analytics/anomalies/detect');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('combos_checked');
    expect(res.body.data).toHaveProperty('anomalies_detected');
  });
});

describe('POST /api/analytics/anomalies/:id/acknowledge', () => {
  it('returns 404 when not found', async () => {
    db.query.mockResolvedValueOnce(mockEmpty());
    const res = await request(app).post('/api/analytics/anomalies/999/acknowledge');
    expect(res.status).toBe(404);
  });

  it('acknowledges anomaly', async () => {
    const ack = { id: 1, is_acknowledged: 1, acknowledged_by: 1 };
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1 }]))
      .mockResolvedValueOnce(mockUpdate())
      .mockResolvedValueOnce(mockRows([ack]));

    const res = await request(app).post('/api/analytics/anomalies/1/acknowledge');
    expect(res.status).toBe(200);
    expect(res.body.data.is_acknowledged).toBe(1);
  });
});

describe('GET /api/analytics/predictive-failure', () => {
  it('returns sfp_degradation and onu_offline', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([]))  // sfpRows
      .mockResolvedValueOnce(mockRows([])); // onuRows

    const res = await request(app).get('/api/analytics/predictive-failure');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('sfp_degradation');
    expect(res.body.data).toHaveProperty('onu_offline');
  });
});

describe('GET /api/analytics/churn-scores', () => {
  it('returns churn scores list', async () => {
    db.query
      .mockResolvedValueOnce(mockRows([{ id: 1, client_id: 5, score: 72.5, risk_band: 'high' }]))
      .mockResolvedValueOnce(mockCount(1));

    const res = await request(app).get('/api/analytics/churn-scores');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].risk_band).toBe('high');
  });
});

describe('POST /api/analytics/churn-scores/compute', () => {
  it('computes churn scores', async () => {
    // clients query
    db.query.mockResolvedValueOnce(mockRows([]));

    const res = await request(app).post('/api/analytics/churn-scores/compute');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('clients_scored');
    expect(res.body.data.clients_scored).toBe(0);
  });
});

describe('GET /api/analytics/alert-correlation', () => {
  it('returns correlation groups', async () => {
    db.query.mockResolvedValueOnce(mockRows([]));
    const res = await request(app).get('/api/analytics/alert-correlation');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('correlated_groups');
  });
});

describe('GET /api/analytics/bandwidth-forecast', () => {
  it('returns forecast (reuses capacityForecast)', async () => {
    // historical data query
    db.query.mockResolvedValueOnce(mockRows([]));
    const res = await request(app).get('/api/analytics/bandwidth-forecast');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('analytics_note');
  });
});
