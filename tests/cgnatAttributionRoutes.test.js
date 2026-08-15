'use strict';

jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    const tokenHeader = req.get('x-test-api-token');
    req.user = {
      id: Number(req.get('x-test-user') || 5),
      role: 'admin',
      organization_id: Number(req.get('x-test-org') || 10),
      apiTokenId: tokenHeader ? Number(tokenHeader) : null,
      scopes: req.get('x-test-scopes')
        ? req.get('x-test-scopes').split(',').filter(Boolean) : [],
      permissions: req.get('x-test-permissions')
        ? req.get('x-test-permissions').split(',').filter(Boolean)
        : [
          'cgnat_attribution.ingest', 'cgnat_attribution.manage',
          'gov_data_requests.view', 'ip_attribution.view',
          'ip_attribution.export', 'connection_logs.view',
        ],
    };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = Number(req.get('x-test-org') || 10);
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: permission => (req, _res, next) => {
    if (req.user.permissions.includes(permission)) return next();
    const error = new Error(`Missing permission: ${permission}`);
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    return next(error);
  },
  userHasPermission: async (req, permission) => req.user.permissions.includes(permission),
}));

jest.mock('../src/middleware/rateLimit', () => ({
  CacheStore: class CacheStore {},
  exportLimiter: (_req, _res, next) => next(),
  apiTokenConfiguredLimiter: (_req, _res, next) => next(),
}));

jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));
jest.mock('../src/services/cgnatAttributionService', () => ({
  ingestBatch: jest.fn(),
  listExporterConfigs: jest.fn(),
  saveExporterConfig: jest.fn(),
  approveReleaseRecovery: jest.fn(),
  lookupAttribution: jest.fn(),
  attributionToCsv: jest.fn(),
}));
jest.mock('../src/services/connectionLoggingReadinessService', () => ({
  getReadiness: jest.fn(),
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const attributionService = require('../src/services/cgnatAttributionService');
const readinessService = require('../src/services/connectionLoggingReadinessService');
const router = require('../src/routes/connectionLogs');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.id = 'request-test-1'; next(); });
app.use('/connection-logs', router);
app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR', message: error.message },
  });
});

function exporterRow(overrides = {}) {
  return {
    id: 7,
    exporter_id: 'edge-1',
    exporter_nas_id: 3,
    exporter_ip: '1.1.1.1',
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_pool_record_id: 5,
    public_ipv4_start: '8.8.8.1',
    public_ipv4_end: '8.8.8.254',
    nat_realm: 'internet',
    collector_api_token_id: 99,
    recovery_collector_api_token_id: null,
    recovery_reference: null,
    recovery_approved_by: null,
    recovery_approved_at: null,
    purpose_reference: 'approved policy REF-1',
    tuple_exclusivity_confirmed: 1,
    authoritative_baseline_confirmed: 1,
    baseline_reference: 'snapshot SNAP-1',
    baseline_confirmed_by: 5,
    baseline_confirmed_at: '2026-07-31T00:00:00.000Z',
    collection_approved_by: 5,
    collection_approved_at: '2026-07-31T00:00:00.000Z',
    enabled: 1,
    is_required: 1,
    retired_at: null,
    retired_by: null,
    ...overrides,
  };
}

function lookupBody() {
  return {
    gov_data_request_id: 81,
    public_ipv4: '8.8.8.8',
    public_port: 45000,
    protocol: 'tcp',
    observed_at: '2026-08-01T00:30:00.000Z',
  };
}

function lookupResult(overrides = {}) {
  return {
    gov_data_request_id: 81,
    status: 'matched',
    reason: null,
    candidate_count: 1,
    attributionMethod: 'cgnat_binding',
    evidence_snapshot_hash: 'a'.repeat(64),
    query: lookupBody(),
    attribution: { binding_id: 71, client_id: 41, contract_id: 51 },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.withPrimaryContext.mockImplementation(callback => callback());
  db.query.mockResolvedValue([{ insertId: 1 }]);
  auditLog.log.mockResolvedValue(undefined);
  attributionService.ingestBatch.mockResolvedValue({
    received: 1, inserted: 1, replayed: 0, allocated: 1, released: 0,
  });
  attributionService.listExporterConfigs.mockResolvedValue([exporterRow()]);
  attributionService.saveExporterConfig.mockResolvedValue(exporterRow());
  attributionService.approveReleaseRecovery.mockResolvedValue(exporterRow({
    recovery_collector_api_token_id: 100,
    recovery_reference: 'INC-2026-08-15-1',
    recovery_approved_by: 17,
    recovery_approved_at: '2026-08-15T12:00:00.000Z',
  }));
  attributionService.lookupAttribution.mockResolvedValue(lookupResult());
  attributionService.attributionToCsv.mockReturnValue('gov_data_request_id,status\r\n81,matched\r\n');
  readinessService.getReadiness.mockResolvedValue({ ready: true, status: 'ready' });
});

describe('CGNAT collector HTTP boundary', () => {
  test('requires an API token rather than an interactive session', async () => {
    const response = await request(app)
      .post('/connection-logs/cgnat-attribution/bindings/ingest')
      .send({ bindings: [{}] });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/requires an organization API token/);
    expect(attributionService.ingestBatch).not.toHaveBeenCalled();
  });

  test('requires the one exact ingest scope and passes only request provenance plus tenant', async () => {
    const wrongScope = await request(app)
      .post('/connection-logs/cgnat-attribution/bindings/ingest')
      .set('x-test-org', '22')
      .set('x-test-api-token', '99')
      .set('x-test-scopes', 'cgnat_attribution:ingest,connection_logs:ingest')
      .send({ bindings: [{}] });
    expect(wrongScope.status).toBe(403);

    const response = await request(app)
      .post('/connection-logs/cgnat-attribution/bindings/ingest')
      .set('x-test-org', '22')
      .set('x-test-api-token', '99')
      .set('x-test-scopes', 'cgnat_attribution:ingest')
      .set('user-agent', 'operator-normalizer/1.0')
      .send({ bindings: [{ event_type: 'allocate' }] });

    expect(response.status).toBe(200);
    expect(attributionService.ingestBatch).toHaveBeenCalledWith(
      22,
      { bindings: [{ event_type: 'allocate' }] },
      expect.objectContaining({
        apiTokenId: 99,
        requestId: expect.any(String),
        sourceIp: expect.any(String),
        userAgent: 'operator-normalizer/1.0',
      }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 22,
      action: 'ingest',
      tableName: 'cgnat_binding_events',
      newValues: expect.objectContaining({ api_token_id: 99 }),
    }));
  });
});

describe('interactive exporter inventory routes', () => {
  test.each([
    ['get', '/connection-logs/cgnat-attribution/exporters'],
    ['put', '/connection-logs/cgnat-attribution/exporters'],
  ])('rejects API-token access to %s exporter inventory', async (method, path) => {
    const response = await request(app)[method](path)
      .set('x-test-api-token', '99')
      .set('x-test-scopes', 'cgnat_attribution:ingest')
      .send(method === 'put' ? { enabled: false } : undefined);

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/interactive user session/);
  });

  test('requires management permission and binds approval to the interactive actor/tenant', async () => {
    const denied = await request(app)
      .put('/connection-logs/cgnat-attribution/exporters')
      .set('x-test-permissions', 'ip_attribution.view')
      .send({ enabled: false });
    expect(denied.status).toBe(403);

    const body = { exporter_id: 'edge-1', enabled: true };
    const response = await request(app)
      .put('/connection-logs/cgnat-attribution/exporters')
      .set('x-test-org', '22')
      .set('x-test-user', '17')
      .send(body);

    expect(response.status).toBe(200);
    expect(attributionService.saveExporterConfig).toHaveBeenCalledWith(
      22, body, { approvalActorId: 17 },
    );
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17,
      organizationId: 22,
      action: 'configure',
      tableName: 'cgnat_exporter_configs',
      recordId: 7,
      newValues: expect.objectContaining({
        exporter_nas_id: 3,
        exporter_ip: '1.1.1.1',
        collection_approved_by: 5,
        authoritative_baseline_confirmed: true,
        baseline_reference: 'snapshot SNAP-1',
      }),
    }));
  });

  test('keeps release recovery interactive and management-only', async () => {
    const body = { collector_api_token_id: 100, incident_reference: 'INC-2026-08-15-1' };
    const tokenResponse = await request(app)
      .post('/connection-logs/cgnat-attribution/exporters/7/release-recovery')
      .set('x-test-api-token', '99')
      .set('x-test-scopes', 'cgnat_attribution:ingest')
      .send(body);
    expect(tokenResponse.status).toBe(403);

    const permissionResponse = await request(app)
      .post('/connection-logs/cgnat-attribution/exporters/7/release-recovery')
      .set('x-test-permissions', 'ip_attribution.view')
      .send(body);
    expect(permissionResponse.status).toBe(403);
    expect(attributionService.approveReleaseRecovery).not.toHaveBeenCalled();
  });

  test('approves and audits release-only recovery for the exact tenant epoch and actor', async () => {
    const body = { collector_api_token_id: 100, incident_reference: 'INC-2026-08-15-1' };
    const response = await request(app)
      .post('/connection-logs/cgnat-attribution/exporters/7/release-recovery')
      .set('x-test-org', '22')
      .set('x-test-user', '17')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 7,
      recovery_collector_api_token_id: 100,
      recovery_reference: 'INC-2026-08-15-1',
    });
    expect(attributionService.approveReleaseRecovery).toHaveBeenCalledWith(
      22, 7, body, { approvalActorId: 17 },
    );
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17,
      organizationId: 22,
      action: 'approve_release_recovery',
      tableName: 'cgnat_exporter_configs',
      recordId: 7,
      summary: expect.stringMatching(/release-only collector.*permanently fail-closed/),
      newValues: expect.objectContaining({
        recovery_collector_api_token_id: 100,
        recovery_reference: 'INC-2026-08-15-1',
        recovery_approved_by: 17,
        evidence_epoch_faulted: true,
      }),
    }));
  });
});

describe('case-bound attribution lookup and export routes', () => {
  test('requires both legal-case view and attribution-view permissions', async () => {
    const noCaseAccess = await request(app)
      .post('/connection-logs/ip-attribution/lookup')
      .set('x-test-permissions', 'ip_attribution.view')
      .send(lookupBody());
    expect(noCaseAccess.status).toBe(403);

    const noAttributionAccess = await request(app)
      .post('/connection-logs/ip-attribution/lookup')
      .set('x-test-permissions', 'gov_data_requests.view')
      .send(lookupBody());
    expect(noAttributionAccess.status).toBe(403);
    expect(attributionService.lookupAttribution).not.toHaveBeenCalled();
  });

  test('pins lookup evidence and audits a hash/outcome without logging the raw tuple', async () => {
    const response = await request(app)
      .post('/connection-logs/ip-attribution/lookup')
      .set('x-test-org', '22')
      .set('x-test-user', '17')
      .send(lookupBody());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'matched', gov_data_request_id: 81 });
    expect(attributionService.lookupAttribution).toHaveBeenCalledWith(
      22, lookupBody(), { actorId: 17, pin: true },
    );

    const auditCall = db.query.mock.calls.find(([sql]) => /INSERT INTO report_access_logs/.test(sql));
    expect(auditCall).toBeDefined();
    expect(auditCall[1].slice(0, 7)).toEqual([
      22, 17, null, 81, 'ip_attribution_lookup', 'ip_attribution_case_evidence',
      expect.any(String),
    ]);
    const parameters = JSON.parse(auditCall[1][6]);
    expect(parameters).toMatchObject({
      outcome: 'matched',
      candidate_count: 1,
      attribution_method: 'cgnat_binding',
      evidence_snapshot_hash: 'a'.repeat(64),
      export_checksum: null,
    });
    expect(parameters.query_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(parameters).not.toHaveProperty('public_ipv4');
    expect(parameters).not.toHaveProperty('public_port');
  });

  test('audits a failed lookup before returning the service error', async () => {
    const error = new Error('Government request tuple mismatch');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    attributionService.lookupAttribution.mockRejectedValueOnce(error);

    const response = await request(app)
      .post('/connection-logs/ip-attribution/lookup')
      .send(lookupBody());

    expect(response.status).toBe(403);
    const auditCall = db.query.mock.calls.find(([sql]) => /INSERT INTO report_access_logs/.test(sql));
    const parameters = JSON.parse(auditCall[1][6]);
    expect(parameters).toMatchObject({
      outcome: 'denied_or_failed', reason: 'FORBIDDEN', candidate_count: 0,
    });
  });

  test('exports exactly the pinned result with a verifiable checksum and case filename', async () => {
    const csv = 'gov_data_request_id,status\r\n81,matched\r\n';
    const checksum = crypto.createHash('sha256').update(csv).digest('hex');

    const response = await request(app)
      .post('/connection-logs/ip-attribution/export')
      .set('x-test-org', '22')
      .set('x-test-user', '17')
      .send(lookupBody());

    expect(response.status).toBe(200);
    expect(response.text).toBe(csv);
    expect(response.headers['x-evidence-sha256']).toBe(checksum);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="ip-attribution-case-81.csv"',
    );
    expect(attributionService.lookupAttribution).toHaveBeenCalledWith(
      22, lookupBody(), { actorId: 17, pin: true },
    );
    expect(attributionService.attributionToCsv).toHaveBeenCalledWith(lookupResult());

    const auditCall = db.query.mock.calls.find(([sql]) => /INSERT INTO report_access_logs/.test(sql));
    const parameters = JSON.parse(auditCall[1][6]);
    expect(parameters).toMatchObject({
      outcome: 'matched',
      evidence_snapshot_hash: 'a'.repeat(64),
      export_checksum: checksum,
    });
  });

  test.each([
    ['API token', {
      'x-test-api-token': '99',
      'x-test-scopes': 'cgnat_attribution:ingest',
    }],
    ['missing export permission', {
      'x-test-permissions': 'gov_data_requests.view,ip_attribution.view',
    }],
  ])('does not expose exports to %s', async (_label, headers) => {
    let operation = request(app).post('/connection-logs/ip-attribution/export');
    Object.entries(headers).forEach(([key, value]) => { operation = operation.set(key, value); });
    const response = await operation.send(lookupBody());

    expect(response.status).toBe(403);
    expect(attributionService.lookupAttribution).not.toHaveBeenCalled();
  });
});

describe('readiness disclosure boundary', () => {
  test('includes CGNAT readiness only for a management or attribution principal', async () => {
    const denied = await request(app)
      .get('/connection-logs/readiness')
      .set('x-test-permissions', 'connection_logs.view');
    expect(denied.status).toBe(200);
    expect(readinessService.getReadiness).toHaveBeenLastCalledWith(10, { includeCgnat: false });

    const allowed = await request(app)
      .get('/connection-logs/readiness')
      .set('x-test-permissions', 'connection_logs.view,ip_attribution.view');
    expect(allowed.status).toBe(200);
    expect(readinessService.getReadiness).toHaveBeenLastCalledWith(10, { includeCgnat: true });
  });
});
