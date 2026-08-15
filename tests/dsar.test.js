// =============================================================================
// FireISP 5.0 — tenant-safe, complete DSAR export tests
// =============================================================================

'use strict';

const request = require('supertest');

const mockQuery = jest.fn();
const mockWithPrimaryContext = jest.fn(callback => callback());
const mockRequirePermission = jest.fn(permission => (req, res, next) => {
  if (req.get('x-test-deny-permission') === permission) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Required permission: ${permission}` } });
  }
  return next();
});

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
  withPrimaryContext: mockWithPrimaryContext,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 1,
      email: 'admin@test.com',
      role: 'admin',
      ...(req.get('x-test-api-token') ? { apiTokenId: 77 } : {}),
    };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 1;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: mockRequirePermission,
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist: () => [],
}));

const app = require('../src/app');

const CLIENT_ROW = {
  id: 42,
  name: 'Juan Pérez',
  email: 'juan@example.com',
  phone: '55-1234-5678',
  client_type: 'personal',
  locale: 'MX',
  tax_id: 'PEPJ800101XXX',
  address: 'Calle 1 #10',
  city: 'CDMX',
  state: 'CDMX',
  zip_code: '06600',
  country: 'MX',
  notes: null,
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  deleted_at: null,
};

const DEFAULT_COLLECTIONS = {
  contacts: [{ id: 1, first_name: 'María', last_name: 'Pérez', email: 'm@ex.com' }],
  mxProfiles: [{ id: 2, rfc: 'PEPJ800101XXX', regimen_fiscal: '612', deleted_at: null }],
  contracts: [{ id: 10, plan_id: 2, status: 'active' }],
  invoices: [{ id: 100, invoice_number: 'INV-0001', total: '499.00', status: 'paid' }],
  payments: [{ id: 200, amount: '499.00', payment_method: 'cash', status: 'completed' }],
  tickets: [{ id: 300, subject: 'No internet', status: 'closed', priority: 'medium' }],
  connectionLogs: [{
    id: 400,
    organization_id: 1,
    client_id: 42,
    username: 'juan_pppoe',
    radius_session_id: 'sess-1',
    assigned_ipv4: '192.0.2.10',
    latest_status: 'stop',
  }],
  radiusAccountingEvents: [{
    id: 410,
    organization_id: 1,
    client_id: 42,
    username: 'juan_pppoe',
    radius_session_id: 'sess-1',
    status_type: 'stop',
  }],
  cgnatAttributionBindings: [{
    id: 420,
    organization_id: 1,
    client_id: 42,
    private_ipv4: '10.0.0.10',
    public_ipv4: '8.8.8.8',
    public_port_start: 45000,
    public_port_end: 45000,
    protocol: 6,
  }],
  cgnatAttributionEvents: [{
    id: 421, organization_id: 1, binding_id: 420,
    event_type: 'allocate', event_id: 'event-1', sequence_number: 0,
  }],
  radiusAccountingUsageDaily: [{
    id: 430,
    organization_id: 1,
    client_id: 42,
    usage_date: '2026-08-14',
    bytes_in_delta: 1000,
    bytes_out_delta: 2000,
  }],
  ipAssignments: [{ id: 500, ip_address: '192.0.2.10', type: 'dynamic', status: 'active' }],
  aiReplyLogs: [{
    id: 600,
    ticket_id: 300,
    action: 'sent',
    draft_text: 'Dear client,',
    final_text: 'Dear client, issue resolved.',
  }],
};

const COLLECTION_MARKERS = [
  ['contacts', 'FROM contacts contact'],
  ['mxProfiles', 'FROM client_mx_profiles mx_profile'],
  ['contracts', 'FROM contracts contract'],
  ['invoices', 'FROM invoices invoice'],
  ['payments', 'FROM payments payment'],
  ['tickets', 'FROM tickets ticket'],
  ['connectionLogs', 'FROM connection_logs session_log'],
  ['radiusAccountingEvents', 'FROM radius_accounting_events accounting_event'],
  ['cgnatAttributionBindings', 'FROM cgnat_attribution_bindings binding'],
  ['cgnatAttributionEvents', 'FROM cgnat_binding_events binding_event'],
  ['radiusAccountingUsageDaily', 'FROM radius_accounting_usage_daily usage_day'],
  ['ipAssignments', 'FROM ip_assignments ip_assignment'],
  ['aiReplyLogs', 'FROM ai_reply_logs ai_reply'],
];

function collectionForSql(sql) {
  return COLLECTION_MARKERS.find(([, marker]) => sql.includes(marker))?.[0];
}

function wireDb({ client = CLIENT_ROW, mxProfile, collections = {}, failOnPage = null, failOnMx = false } = {}) {
  const data = { ...DEFAULT_COLLECTIONS, ...collections };
  const profile = mxProfile === undefined
    ? { id: 1, rfc: 'PEPJ800101XXX', regimen_fiscal: '612', zip_code: '06600' }
    : mxProfile;

  mockQuery.mockImplementation(async (sql, params = []) => {
    if (/INSERT INTO report_access_logs/.test(sql)) return [{ insertId: 900 }];

    if (/FROM clients\s+WHERE id = \? AND organization_id = \?/.test(sql)) {
      return [[client || undefined]];
    }

    if (sql.includes('FROM client_mx_profiles profile')) {
      if (failOnMx) throw new Error('failed before response headers');
      return [[profile || undefined]];
    }

    const key = collectionForSql(sql);
    if (!key) return [[]];
    const rows = data[key] || [];

    if (sql.includes('SELECT MAX(')) {
      return [[{ max_id: rows.length ? rows[rows.length - 1].id : null }]];
    }

    if (key === failOnPage) throw new Error(`failed while streaming ${key}`);

    const cursor = params[params.length - 2];
    const maxId = params[params.length - 1];
    return [rows.filter(row => Number(row.id) > Number(cursor) && Number(row.id) <= Number(maxId)).slice(0, 1000)];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithPrimaryContext.mockImplementation(callback => callback());
});

describe('GET /api/v1/dsar/clients/:id', () => {
  test('returns every enumerated subject dataset with honest scope and cancellation metadata', async () => {
    wireDb();

    const res = await request(app).get('/api/v1/dsar/clients/42');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.meta).toMatchObject({
      clientId: 42,
      organizationId: 1,
      version: '2.0',
      requestedBy: 'admin@test.com',
      completeForEnumeratedDatasets: true,
      scope: {
        organizationScoped: true,
        allStorageSystemsCovered: false,
      },
      cancellation: {
        automaticDeletionPerformed: false,
        handling: 'review_required',
      },
    });
    expect(Number.isNaN(Date.parse(res.body.meta.generatedAt))).toBe(false);

    const { data } = res.body;
    expect(data.client.name).toBe('Juan Pérez');
    expect(data.mxProfile).not.toBeNull();
    for (const key of Object.keys(DEFAULT_COLLECTIONS)) {
      expect(data[key]).toEqual(DEFAULT_COLLECTIONS[key]);
      expect(res.body.meta.collectionCounts[key]).toBe(DEFAULT_COLLECTIONS[key].length);
    }
    expect(data.radiusAccountingEvents[0].status_type).toBe('stop');
    expect(data.cgnatAttributionBindings[0]).toMatchObject({
      public_ipv4: '8.8.8.8', public_port_start: 45000,
    });
    expect(JSON.stringify(data)).not.toMatch(/destination_ip|url|content/i);
    expect(data.aiReplyLogs[0]).not.toHaveProperty('context_snapshot');
    expect(data.aiReplyLogs[0]).not.toHaveProperty('prompt_hash');
  });

  test.each([
    'clients.view',
    'dsar_requests.manage',
    'connection_logs.export',
  ])('denies the complete export when %s is missing', async (permission) => {
    wireDb();
    const res = await request(app)
      .get('/api/v1/dsar/clients/42')
      .set('x-test-deny-permission', permission);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain(permission);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('keyset-pages past the former caps without truncating connection or AI rows', async () => {
    const connectionLogs = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      organization_id: 1,
      client_id: 42,
      username: 'juan_pppoe',
    }));
    const aiReplyLogs = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      ticket_id: 300,
      action: 'sent',
      final_text: `reply-${index + 1}`,
    }));
    wireDb({ collections: { connectionLogs, aiReplyLogs } });

    const res = await request(app).get('/api/v1/dsar/clients/42');

    expect(res.status).toBe(200);
    expect(res.body.data.connectionLogs).toHaveLength(1001);
    expect(res.body.data.aiReplyLogs).toHaveLength(1001);
    expect(res.body.meta.collectionCounts.connectionLogs).toBe(1001);
    expect(res.body.meta.collectionCounts.aiReplyLogs).toBe(1001);

    const connectionPageQueries = mockQuery.mock.calls.filter(([sql]) => (
      sql.includes('FROM connection_logs session_log') && !sql.includes('SELECT MAX(')
    ));
    const aiPageQueries = mockQuery.mock.calls.filter(([sql]) => (
      sql.includes('FROM ai_reply_logs ai_reply') && !sql.includes('SELECT MAX(')
    ));
    expect(connectionPageQueries).toHaveLength(2);
    expect(aiPageQueries).toHaveLength(2);
    expect(connectionPageQueries[0][0]).toContain('LIMIT 1000');
    expect(connectionPageQueries[0][0]).not.toMatch(/LIMIT\s+500\b/);
    expect(aiPageQueries[0][0]).not.toMatch(/LIMIT\s+200\b/);
  });

  test('scopes every collection query to both the organization and subject identity', async () => {
    wireDb();
    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);

    const collectionCalls = mockQuery.mock.calls.filter(([sql]) => collectionForSql(sql));
    expect(collectionCalls).not.toHaveLength(0);
    for (const [sql, params] of collectionCalls) {
      expect(sql).toMatch(/organization_id = \?/);
      expect(params.map(Number)).toContain(1);
      expect(params.map(Number)).toContain(42);
    }

    const sessionSql = collectionCalls.find(([sql]) => sql.includes('FROM connection_logs session_log'))[0];
    expect(sessionSql).toContain('session_log.client_id = ? AND session_log.organization_id = ?');

    const evidenceSql = collectionCalls.find(([sql]) => sql.includes('FROM radius_accounting_events accounting_event'))[0];
    expect(evidenceSql).toContain('accounting_event.organization_id = ?');
    expect(evidenceSql).toContain('subject_session.organization_id = ?');
    expect(evidenceSql).toContain('subject_session.client_id = ?');

    const bindingSql = collectionCalls.find(([sql]) => sql.includes('FROM cgnat_attribution_bindings binding'))[0];
    expect(bindingSql).toContain('binding.organization_id = ?');
    expect(bindingSql).toContain('subject_session.client_id = ?');
    const eventSql = collectionCalls.find(([sql]) => sql.includes('FROM cgnat_binding_events binding_event'))[0];
    expect(eventSql).toContain('binding_event.organization_id = ?');
    expect(eventSql).toContain('subject_session.client_id = ?');
  });

  test('writes an attributable primary-control-plane access record including API-token context', async () => {
    wireDb();
    const res = await request(app)
      .get('/api/v1/dsar/clients/42')
      .set('x-test-api-token', '1')
      .set('user-agent', 'dsar-test-agent');

    expect(res.status).toBe(200);
    expect(mockWithPrimaryContext).toHaveBeenCalledTimes(2);
    const auditCalls = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO report_access_logs/.test(sql));
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0][0]).toContain("'dsar_client_export'");
    expect(auditCalls[0][1][0]).toBe(1);
    expect(auditCalls[0][1][1]).toBe(1);
    expect(auditCalls[0][1][2]).toBe(77);
    expect(auditCalls[0][1][3]).toBe(42);
    expect(auditCalls[0][1][6]).toBe('dsar-test-agent');
    expect(JSON.parse(auditCalls[0][1][4])).toMatchObject({
      client_id: 42,
      status: 'started',
      authentication: 'api_token',
      api_token_id: 77,
      actor_email: 'admin@test.com',
      complete_for_enumerated_datasets: false,
    });
    expect(JSON.parse(auditCalls[1][1][4])).toMatchObject({
      status: 'completed',
      complete_for_enumerated_datasets: true,
      collection_counts: expect.objectContaining({
        connectionLogs: 1,
        radiusAccountingEvents: 1,
        cgnatAttributionBindings: 1,
        cgnatAttributionEvents: 1,
      }),
    });
  });

  test('does not issue destructive SQL while handling cancellation metadata', async () => {
    wireDb();
    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.meta.cancellation.automaticDeletionPerformed).toBe(false);
    const sql = mockQuery.mock.calls.map(call => call[0]).join('\n');
    expect(sql).not.toMatch(/\b(?:DELETE|UPDATE)\b/i);
  });

  test('returns 404 before querying any subject collection when the client is outside the org', async () => {
    wireDb({ client: null });
    const res = await request(app).get('/api/v1/dsar/clients/9999');
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([9999, 1]);
  });

  test('returns null mxProfile without weakening its same-org client join', async () => {
    wireDb({ mxProfile: null });
    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.data.mxProfile).toBeNull();
    const [sql, params] = mockQuery.mock.calls.find(([query]) => query.includes('FROM client_mx_profiles profile'));
    expect(sql).toContain('subject_client.organization_id = ?');
    expect(params).toEqual([42, 42, 1]);
  });

  test('returns 500 when the initial database lookup fails before streaming', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(500);
  });

  test('returns a normal API error and audits failure when a post-validation query fails before headers', async () => {
    wireDb({ failOnMx: true });
    const res = await request(app).get('/api/v1/dsar/clients/42');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    const auditStatuses = mockQuery.mock.calls
      .filter(([sql]) => /INSERT INTO report_access_logs/.test(sql))
      .map(([, params]) => JSON.parse(params[4]).status);
    expect(auditStatuses).toEqual(['started', 'failed']);
    expect(auditStatuses).not.toContain('completed');
  });

  test('terminates a response that fails after headers instead of emitting complete-looking JSON', async () => {
    wireDb({ failOnPage: 'cgnatAttributionEvents' });

    let streamError;
    try {
      await request(app).get('/api/v1/dsar/clients/42');
    } catch (err) {
      streamError = err;
    }

    expect(streamError).toBeDefined();
    expect(String(streamError.message)).toMatch(/aborted|socket hang up/i);
    const auditStatuses = mockQuery.mock.calls
      .filter(([sql]) => /INSERT INTO report_access_logs/.test(sql))
      .map(([, params]) => JSON.parse(params[4]).status);
    expect(auditStatuses).toEqual(['started', 'failed']);
    expect(auditStatuses).not.toContain('completed');
  });
});
