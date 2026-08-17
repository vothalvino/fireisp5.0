// =============================================================================
// FireISP 5.0 — Trap Forwarding Rule Route Tests (§6.1)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock('net-snmp', () => ({}), { virtual: true });

jest.mock('../src/services/trapForwardingReadinessService', () => ({
  checkSchemaReadiness: jest.fn(),
  checkPrimarySchemaReadiness: jest.fn(),
  invalidateSchemaReadinessCache: jest.fn(),
}));

jest.mock('../src/services/snmpTrapReceiver', () => ({
  getStatus: jest.fn(),
  getDailyIngestUsage: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const dns = require('node:dns').promises;
const config = require('../src/config');
const db = require('../src/config/database');
const trapForwardingReadiness = require('../src/services/trapForwardingReadinessService');
const snmpTrapReceiver = require('../src/services/snmpTrapReceiver');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function viewOnlyToken() {
  return jwt.sign(
    { sub: 2, email: 'viewer@test.com', role: 'support', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const sampleRule = {
  id: 1,
  organization_id: 10,
  name: 'Link Down Forward',
  match_trap_type: 'linkDown',
  match_source_ip: null,
  match_oid_prefix: null,
  forward_to_url: 'https://8.8.8.8/snmp?token=LIST_RESPONSE_SECRET',
  forward_to_email: null,
  forward_to_webhook_id: null,
  transform_template: 'LEGACY_TRANSFORM_AUDIT_SECRET',
  is_active: 1,
  configuration_reviewed_at: '2026-08-17 01:00:00',
  deleted_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function mockDbDefault() {
  db.query.mockImplementation((sql, params = []) => {
    if (typeof sql === 'string' && sql.includes('FROM organizations')) {
      return Promise.resolve([[
        { id: 10, status: 'active', deleted_at: null, outbound_delivery_epoch: 7 },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('FROM webhooks')) {
      return Promise.resolve([params.includes(44) ? [{
        id: 44,
        organization_id: 10,
        url: 'https://8.8.8.8/traps',
        is_active: 1,
        deleted_at: null,
      }] : []]);
    }
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('trap_forwarding') && !sql.includes('snmp_trap_forwarding')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[
        { id: 1, name: 'trap_forwarding.view' },
        { id: 2, name: 'trap_forwarding.create' },
        { id: 3, name: 'trap_forwarding.update' },
        { id: 4, name: 'trap_forwarding.delete' },
      ]]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO snmp_trap_forwarding_rules')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO snmp_trap_forwarding_deliveries')) {
      return Promise.resolve([{ insertId: 501 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE snmp_trap_forwarding_rules')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('SET deleted_at')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    // Default: return sample rule
    return Promise.resolve([[sampleRule]]);
  });
}

function mockTransactionalConnection() {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    destroy: jest.fn(),
    // Keep every route assertion on the shared db.query spy while still
    // exercising the production transaction/locked-row path.
    execute: jest.fn((...args) => db.query(...args)),
  };
  db.getConnection.mockResolvedValue(connection);
  return connection;
}

describe('Trap Forwarding Rule routes', () => {
  const token = adminToken();
  const ingestUsage = {
    usage_date: '2026-08-17',
    trap_count: 321,
    trap_limit: 10000,
    varbind_bytes: 4096,
    varbind_byte_limit: 16777216,
    delivery_count: 99,
    delivery_limit: 10000,
    metadata_only_count: 7,
    dropped_trap_count: 2,
    forwarding_skipped_count: 3,
  };
  const usageResult = {
    organization: ingestUsage,
    global: {
      usage_date: '2026-08-17',
      trap_count: 87654,
      trap_limit: 100000,
      varbind_bytes: 7654321,
      varbind_byte_limit: 134217728,
      delivery_count: 65432,
      delivery_limit: 100000,
      metadata_only_count: 123,
      dropped_trap_count: 45,
      forwarding_skipped_count: 67,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValue({
      ready: true,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: null,
    });
    snmpTrapReceiver.getStatus.mockReturnValue({
      enabled: true, state: 'listening', listening: true, ready: true, reason: null,
    });
    snmpTrapReceiver.getDailyIngestUsage.mockResolvedValue(usageResult);
    mockDbDefault();
    mockTransactionalConnection();
  });

  test('GET /readiness returns the exact ready DTO and is never cacheable', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { ready: true, status: 'ready', reason: null, ingest: ingestUsage },
    });
    expect(snmpTrapReceiver.getDailyIngestUsage).toHaveBeenCalledWith(10);
    expect(JSON.stringify(res.body)).not.toMatch(/87654|7654321|65432/);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.headers.pragma).toBe('no-cache');
  });

  test('GET /readiness exposes one stable unavailable reason for retained isolated configuration', async () => {
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [{
        organization_id: 22,
        ready: false,
        reason: 'isolated_tenant_attribution_unsupported',
      }],
      reason: 'isolated_tenant_attribution_unsupported',
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        ready: false,
        status: 'unavailable',
        reason: 'isolated_tenant_attribution_unsupported',
        ingest: ingestUsage,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('22');
  });

  test('GET /readiness exposes the stable multi-organization policy reason without tenant details', async () => {
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: 'multi_organization_attribution_unsupported',
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        ready: false,
        status: 'unavailable',
        reason: 'multi_organization_attribution_unsupported',
        ingest: ingestUsage,
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/organization_id|organizations|\b10\b/);
  });

  test('GET /readiness distinguishes primary schema and listener failures without internals', async () => {
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: false,
      primary: { ready: false, reason: 'primary_schema_unavailable' },
      isolated: [],
      reason: 'primary_schema_unavailable',
    });
    const primary = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');
    expect(primary.body).toEqual({
      data: {
        ready: false,
        status: 'unavailable',
        reason: 'primary_schema_unavailable',
        ingest: null,
      },
    });

    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: true,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: null,
    });
    snmpTrapReceiver.getStatus.mockReturnValueOnce({
      enabled: true, state: 'failed', listening: false, ready: false, reason: 'bind_failed',
    });
    const listener = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');
    expect(listener.body).toEqual({
      data: {
        ready: false,
        status: 'unavailable',
        reason: 'bind_failed',
        ingest: ingestUsage,
      },
    });
    expect(JSON.stringify(listener.body)).not.toMatch(/EADDRINUSE|stack/i);
  });

  test('GET /readiness keeps the safe quota field nullable when usage lookup fails', async () => {
    snmpTrapReceiver.getDailyIngestUsage.mockRejectedValueOnce(
      new Error('private database diagnostics must not leak'),
    );

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/readiness')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { ready: true, status: 'ready', reason: null, ingest: null },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/private database|diagnostics|stack/i);
  });

  test('GET /api/v1/trap-forwarding-rules returns list', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.body.data[0]).toMatchObject({
      target_type: 'url',
      target_display: null,
      target_display_code: 'direct_https_url',
      target_needs_attention: false,
      transform_supported: false,
    });
    expect(res.body.data[0]).not.toHaveProperty('forward_to_url');
    expect(res.body.data[0]).not.toHaveProperty('forward_to_email');
    expect(res.body.data[0]).not.toHaveProperty('forward_to_webhook_id');
    expect(JSON.stringify(res.body)).not.toMatch(/LIST_RESPONSE_SECRET|8\.8\.8\.8/);
  });

  test('GET list ignores hidden destination filters and sort fields without creating an inference oracle', async () => {
    const hiddenUrl = 'https://8.8.8.8/private?token=FILTER_ORACLE_SECRET';
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules')
      .query({
        forward_to_url: hiddenUrl,
        forward_to_email: 'private-recipient@example.com',
        forward_to_webhook_id: '44',
        order_by: 'forward_to_url',
        order: 'DESC',
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/FILTER_ORACLE_SECRET|private-recipient@example\.com/);
    const ruleReads = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /FROM `snmp_trap_forwarding_rules`/.test(sql),
    );
    expect(ruleReads).toHaveLength(2);
    for (const [sql, params] of ruleReads) {
      expect(sql).not.toMatch(/`forward_to_(?:url|email|webhook_id)`/);
      expect(params).not.toEqual(expect.arrayContaining([hiddenUrl, 'private-recipient@example.com', '44', 44]));
    }
    const listSql = ruleReads.find(([sql]) => /ORDER BY/.test(sql))[0];
    expect(listSql).toMatch(/ORDER BY `id` DESC/);
  });

  test('GET /api/v1/trap-forwarding-rules/:id returns single rule', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 1);
    expect(res.body.data).toMatchObject({
      target_type: 'url',
      target_display: null,
      target_display_code: 'direct_https_url',
    });
    expect(JSON.stringify(res.body)).not.toContain('LIST_RESPONSE_SECRET');
  });

  test('view DTO uses a localization code without leaking email recipient or capability hostname', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string' && /FROM `snmp_trap_forwarding_rules`/.test(sql)
          && !sql.includes('COUNT(*)')) {
        return Promise.resolve([[
          {
            ...sampleRule,
            forward_to_url: null,
            forward_to_email: 'private.recipient@capability-host.example',
          },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      target_type: 'email',
      target_display: null,
      target_display_code: 'email_recipient',
      target_needs_attention: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/private\.recipient|capability-host\.example/);
  });

  test('registered-webhook view DTO never exposes its id or user-authored description', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string' && /FROM `snmp_trap_forwarding_rules`/.test(sql) && !sql.includes('COUNT(*)')) {
        return Promise.resolve([[{
          ...sampleRule,
          forward_to_url: null,
          forward_to_webhook_id: 44,
        }]]);
      }
      if (typeof sql === 'string' && sql.includes('FROM webhooks') && sql.includes('id IN')) {
        return Promise.resolve([[
          { id: 44, url: 'https://8.8.8.8/private', description: 'SENSITIVE INTERNAL CUSTOMER LABEL' },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      target_type: 'webhook',
      target_display: null,
      target_display_code: 'registered_webhook',
      target_needs_attention: false,
    });
    expect(res.body.data[0]).not.toHaveProperty('forward_to_webhook_id');
    expect(JSON.stringify(res.body)).not.toMatch(/SENSITIVE INTERNAL CUSTOMER LABEL|8\.8\.8\.8|"44"/);
  });

  test('GET /:id/configuration confines the full destination to the edit-only response', async () => {
    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/1/configuration')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.body.data).toEqual({
      id: 1,
      forward_to_url: 'https://8.8.8.8/snmp?token=LIST_RESPONSE_SECRET',
      forward_to_email: null,
      forward_to_webhook_id: null,
    });
    const lookup = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('snmp_trap_forwarding_rules') && sql.includes('WHERE id = ?'),
    );
    expect(lookup[0]).toMatch(/organization_id = \?/);
    expect(lookup[1]).toEqual(['1', 10]);
  });

  test('GET /destinations exposes only tenant-owned webhook identity, never path/query credentials', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string' && sql.includes('FROM webhooks') && sql.includes('ORDER BY id')) {
        return Promise.resolve([[
          {
            id: 44,
            description: 'NOC Slack',
            url: 'https://hooks.slack.example/services/TENANT/CHANNEL/PATH_SECRET?token=QUERY_SECRET',
          },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/destinations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{
      id: 44,
      label: 'NOC Slack',
      url: 'https://hooks.slack.example',
    }]);
    expect(JSON.stringify(res.body)).not.toMatch(/PATH_SECRET|QUERY_SECRET|\/services\//);
    const lookup = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM webhooks') && sql.includes('ORDER BY id'),
    );
    expect(lookup[0]).toMatch(/organization_id = \?/);
    expect(lookup[0]).toMatch(/is_active = 1/);
    expect(lookup[0]).toMatch(/deleted_at IS NULL/);
    expect(lookup[1]).toEqual([10]);
  });

  test('GET /destinations denies a view-only user who cannot create or update rules', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string' && /FROM `users` WHERE id = \?/.test(sql)) {
        return Promise.resolve([[
          { id: 2, email: 'viewer@test.com', role: 'support', status: 'active', organization_id: 10 },
        ]]);
      }
      if (typeof sql === 'string' && /SELECT g\.id AS group_id/.test(sql)) return Promise.resolve([[]]);
      if (typeof sql === 'string'
          && /SELECT DISTINCT p\.name AS slug\s+FROM organization_users/.test(sql)) {
        return Promise.resolve([[{ slug: 'trap_forwarding.view' }]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/destinations')
      .set('Authorization', `Bearer ${viewOnlyToken()}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(403);
    expect(db.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM webhooks') && sql.includes('ORDER BY id'),
    )).toBe(false);
  });

  test('GET /:id/deliveries is tenant-scoped and never selects payload or destination snapshots', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string' && sql.includes('FROM snmp_trap_forwarding_deliveries')) {
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
        return Promise.resolve([[
          {
            id: 501,
            trap_id: 701,
            target_type: 'url',
            status: 'success',
            attempt_number: 1,
            max_attempts: 4,
          },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .get('/api/v1/trap-forwarding-rules/1/deliveries')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 501, status: 'success' });
    const deliveryQueries = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM snmp_trap_forwarding_deliveries'),
    );
    expect(deliveryQueries).toHaveLength(2);
    for (const [sql, params] of deliveryQueries) {
      expect(sql).toMatch(/rule_id = \? AND organization_id = \?/);
      expect(params).toEqual(['1', 10]);
      expect(sql).not.toMatch(/\bpayload\b|target_url|target_email|webhook_id/);
    }
  });

  test('POST /:id/test queues a privacy-safe durable test delivery', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules/1/test')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ id: 501, status: 'pending', is_test: true });
    const insert = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO snmp_trap_forwarding_deliveries'),
    );
    expect(insert).toBeDefined();
    const payload = insert[1][8];
    expect(payload).toContain('"event":"snmp.trap.test"');
    expect(payload).not.toMatch(/community|varbind|password/i);
  });

  test('POST /:id/restore revalidates an active destination before reviving it', async () => {
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string'
          && sql.includes('FROM snmp_trap_forwarding_rules')
          && sql.includes('deleted_at IS NOT NULL')) {
        return Promise.resolve([[
          {
            ...sampleRule,
            deleted_at: '2026-08-16T00:00:00.000Z',
            forward_to_url: 'https://169.254.169.254/latest/meta-data/',
          },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules/1/restore')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(422);
    expect(db.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('SET deleted_at = NULL'),
    )).toBe(false);
  });

  test('POST /api/v1/trap-forwarding-rules creates a rule', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Link Down Forward',
        match_trap_type: 'linkDown',
        forward_to_url: 'https://8.8.8.8/snmp',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('forward_to_url');
    expect(res.body.data).not.toHaveProperty('forward_to_email');
    expect(res.body.data).not.toHaveProperty('forward_to_webhook_id');
  });

  test('POST audit snapshot retains safe rule metadata but excludes every destination secret', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Audited link-down rule',
        match_trap_type: 'linkDown',
        forward_to_url: 'https://8.8.8.8/hook?token=CREATE_AUDIT_SECRET',
      });

    expect(res.status).toBe(201);
    const auditInsert = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    );
    const newValues = JSON.parse(auditInsert[1][7]);
    expect(newValues).toMatchObject({
      name: 'Audited link-down rule',
      match_trap_type: 'linkDown',
      organization_id: 10,
    });
    expect(JSON.stringify(newValues)).not.toMatch(/forward_to_|transform_template|CREATE_AUDIT_SECRET/);
  });

  test('PUT audit snapshots redact old and new targets while retaining safe changed metadata', async () => {
    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Audited renamed rule',
        match_trap_type: 'linkUp',
        forward_to_url: null,
        forward_to_email: 'UPDATE_AUDIT_SECRET@example.com',
      });

    expect(res.status).toBe(200);
    const auditInsert = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    );
    const oldValues = JSON.parse(auditInsert[1][6]);
    const newValues = JSON.parse(auditInsert[1][7]);
    expect(oldValues).toMatchObject({ id: 1, name: 'Link Down Forward', match_trap_type: 'linkDown' });
    expect(newValues).toMatchObject({ name: 'Audited renamed rule', match_trap_type: 'linkUp' });
    expect(JSON.stringify({ oldValues, newValues })).not.toMatch(
      /forward_to_|transform_template|LIST_RESPONSE_SECRET|LEGACY_TRANSFORM_AUDIT_SECRET|UPDATE_AUDIT_SECRET/,
    );
  });

  test('PUT rolls back its main write when the exact-field review CAS loses to a legacy writer', async () => {
    const connection = mockTransactionalConnection();
    const fallback = db.query.getMockImplementation();
    let operationalWriteComplete = false;
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string'
          && /UPDATE snmp_trap_forwarding_rules/.test(sql)
          && /SET configuration_reviewed_at/.test(sql)) {
        // The compare-and-set lost because an older application changed the
        // destination after this request validated and wrote its candidate.
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      if (typeof sql === 'string'
          && /UPDATE `snmp_trap_forwarding_rules`/.test(sql)
          && !/configuration_reviewed_at/.test(sql)) {
        operationalWriteComplete = true;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (operationalWriteComplete
          && typeof sql === 'string'
          && /FROM `snmp_trap_forwarding_rules`/.test(sql)) {
        return Promise.resolve([[
          {
            ...sampleRule,
            name: 'Validated candidate',
            forward_to_url: null,
            forward_to_email: 'validated@example.com',
            configuration_reviewed_at: null,
          },
        ]]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Validated candidate',
        forward_to_url: null,
        forward_to_email: 'validated@example.com',
      });

    expect(res.status).toBe(409);
    const markerWrite = connection.execute.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /SET configuration_reviewed_at/.test(sql),
    );
    expect(markerWrite).toBeDefined();
    for (const field of [
      'match_trap_type',
      'match_source_ip',
      'match_oid_prefix',
      'forward_to_url',
      'forward_to_email',
    ]) {
      expect(markerWrite[0]).toMatch(
        new RegExp(`BINARY\\s+${field}\\s*<=>\\s*BINARY\\s+\\?`),
      );
    }
    for (const field of ['forward_to_webhook_id', 'is_active']) {
      expect(markerWrite[0]).toMatch(new RegExp(`${field}\\s*<=>\\s*\\?`));
    }
    const mainWriteIndex = connection.execute.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string'
        && /UPDATE `snmp_trap_forwarding_rules`/.test(sql)
        && !/SET configuration_reviewed_at/.test(sql),
    );
    const markerWriteIndex = connection.execute.mock.calls.indexOf(markerWrite);
    expect(mainWriteIndex).toBeGreaterThanOrEqual(0);
    expect(markerWriteIndex).toBeGreaterThan(mainWriteIndex);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.rollback.mock.invocationCallOrder[0])
      .toBeGreaterThan(connection.execute.mock.invocationCallOrder[markerWriteIndex]);
    expect(db.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    )).toBe(false);
  });

  test('restore rolls back the un-delete when its exact-field review CAS loses', async () => {
    const connection = mockTransactionalConnection();
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params = []) => {
      if (typeof sql === 'string'
          && /FROM snmp_trap_forwarding_rules/.test(sql)
          && /deleted_at IS NOT NULL/.test(sql)) {
        return Promise.resolve([[
          {
            ...sampleRule,
            deleted_at: '2026-08-16T00:00:00.000Z',
            configuration_reviewed_at: null,
          },
        ]]);
      }
      if (typeof sql === 'string'
          && /UPDATE snmp_trap_forwarding_rules/.test(sql)
          && /SET configuration_reviewed_at/.test(sql)) {
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      return fallback(sql, params);
    });

    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules/1/restore')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(409);
    const archivedRead = connection.execute.mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && /FROM snmp_trap_forwarding_rules/.test(sql)
        && /deleted_at IS NOT NULL/.test(sql),
    );
    expect(archivedRead).toBeDefined();
    // Validation must be protected by the same row lock as restore. Without
    // this, an old writer can replace the destination after validation and
    // the later exact-field CAS would review that unvalidated replacement.
    expect(archivedRead[0]).toMatch(/FOR UPDATE/);
    const restoreWriteIndex = connection.execute.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string' && /SET deleted_at = NULL/.test(sql),
    );
    const markerWriteIndex = connection.execute.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string' && /SET configuration_reviewed_at/.test(sql),
    );
    expect(restoreWriteIndex).toBeGreaterThanOrEqual(0);
    expect(markerWriteIndex).toBeGreaterThan(restoreWriteIndex);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    )).toBe(false);
  });

  test('DELETE audit snapshot redacts the archived destination and legacy transform', async () => {
    const res = await request(app)
      .delete('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect(res.status).toBe(204);
    const auditInsert = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    );
    const oldValues = JSON.parse(auditInsert[1][6]);
    expect(oldValues).toMatchObject({ id: 1, name: 'Link Down Forward', match_trap_type: 'linkDown' });
    expect(JSON.stringify(oldValues)).not.toMatch(
      /forward_to_|transform_template|LIST_RESPONSE_SECRET|LEGACY_TRANSFORM_AUDIT_SECRET/,
    );
  });

  test('POST strips unsupported legacy transform templates and never echoes them', async () => {
    const marker = '{{ community }}-PRIVATE_TEMPLATE_MARKER';
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'No hidden transforms',
        forward_to_email: 'noc@example.com',
        transform_template: marker,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ transform_supported: false });
    expect(res.body.data).not.toHaveProperty('transform_template');
    expect(JSON.stringify(res.body)).not.toContain(marker);
    const ruleWrites = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /snmp_trap_forwarding_rules/i.test(sql),
    );
    expect(JSON.stringify(ruleWrites)).not.toContain(marker);
  });

  test('POST requires exactly one delivery destination', async () => {
    const noDestination = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Nowhere' });

    expect(noDestination.status).toBe(422);

    const multipleDestinations = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({
        name: 'Ambiguous destination',
        forward_to_email: 'noc@example.com',
        forward_to_url: 'https://8.8.8.8/snmp',
      });

    expect(multipleDestinations.status).toBe(422);
  });

  test('POST validates email destinations', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Email NOC', forward_to_email: 'not-an-email' });

    expect(res.status).toBe(422);
  });

  test.each([
    'http://8.8.8.8/snmp',
    'ftp://8.8.8.8/snmp',
    'https://127.0.0.1/snmp',
    'https://2130706433/snmp',
    'https://10.0.0.1/snmp',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/snmp',
    'https://[fe90::1]/snmp',
    'https://[::ffff:7f00:1]/snmp',
    'https://[::7f00:1]/snmp',
    'https://[64:ff9b::7f00:1]/snmp',
    'https://[64:ff9b:1::7f00:1]/snmp',
    'https://user:password@8.8.8.8/snmp',
    'https://8.8.8.8/snmp#ignored-fragment',
  ])('POST rejects unsafe URL destination %s', async (forward_to_url) => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Unsafe URL', forward_to_url });

    expect(res.status).toBe(422);
  });

  test('POST accepts only an active registered webhook owned by the organization', async () => {
    const valid = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Owned webhook', forward_to_webhook_id: 44 });
    expect(valid.status).toBe(201);
    const ownershipLookup = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM webhooks'),
    );
    expect(ownershipLookup).toBeDefined();
    expect(ownershipLookup[0]).toMatch(/organization_id\s*=\s*\?/);
    expect(ownershipLookup[0]).toMatch(/is_active\s*=\s*1/);
    expect(ownershipLookup[0]).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(ownershipLookup[1]).toEqual(expect.arrayContaining([10, 44]));

    const foreignOrMissing = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Foreign webhook', forward_to_webhook_id: 99 });
    expect(foreignOrMissing.status).toBe(422);
  });

  test.each([0, -1, 1.5])('POST rejects invalid registered webhook id %s', async (forward_to_webhook_id) => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Bad webhook id', forward_to_webhook_id });

    expect(res.status).toBe(422);
  });

  test('PUT allows an ordinary partial edit without re-sending its destination', async () => {
    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Renamed rule' });

    expect(res.status).toBe(200);
  });

  test('activation keeps readiness, rule validation, write, and review on one held connection', async () => {
    const fallback = db.query.getMockImplementation();
    const connection = mockTransactionalConnection();
    let transactionOpen = false;
    let activated = false;
    connection.beginTransaction.mockImplementation(async () => { transactionOpen = true; });
    connection.commit.mockImplementation(async () => { transactionOpen = false; });
    connection.rollback.mockImplementation(async () => { transactionOpen = false; });
    db.query.mockImplementation((sql, params = []) => {
      if (transactionOpen) {
        throw new Error(`Pool saturated: transactional hook escaped its connection: ${sql}`);
      }
      if (/SELECT \* FROM `snmp_trap_forwarding_rules`/.test(sql)) {
        return Promise.resolve([[{
          ...sampleRule,
          is_active: 0,
          configuration_reviewed_at: null,
        }]]);
      }
      if (/SELECT COUNT\(\*\) AS total[\s\S]*FROM snmp_trap_forwarding_rules/.test(sql)) {
        return Promise.resolve([[{ total: 0 }]]);
      }
      return fallback(sql, params);
    });
    connection.execute.mockImplementation((sql, params = []) => {
      if (/transaction_readiness_probe/.test(sql)) return Promise.resolve([[{ ok: 1 }]]);
      if (/SELECT COUNT\(\*\) AS total[\s\S]*FROM snmp_trap_forwarding_rules/.test(sql)) {
        return Promise.resolve([[{ total: 0 }]]);
      }
      if (/SELECT \* FROM `snmp_trap_forwarding_rules`/.test(sql)) {
        return Promise.resolve([[{
          ...sampleRule,
          is_active: activated ? 1 : 0,
          configuration_reviewed_at: activated ? '2026-08-17 02:00:00' : null,
        }]]);
      }
      if (/UPDATE `snmp_trap_forwarding_rules`/.test(sql)) {
        activated = true;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/UPDATE snmp_trap_forwarding_rules[\s\S]*SET configuration_reviewed_at/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return fallback(sql, params);
    });
    trapForwardingReadiness.checkSchemaReadiness.mockImplementationOnce(async (options) => {
      expect(options).toMatchObject({ force: true, exec: expect.any(Function) });
      await expect(options.exec('SELECT 1 AS transaction_readiness_probe'))
        .resolves.toEqual([[{ ok: 1 }]]);
      return {
        ready: true,
        primary: { ready: true, reason: null },
        isolated: [],
        reason: null,
      };
    });

    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ is_active: true });

    expect(res.status).toBe(200);
    expect(db.getConnection).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /transaction_readiness_probe/.test(sql)))
      .toBe(true);
    expect(connection.execute.mock.calls.some(
      ([sql]) => /SELECT COUNT\(\*\) AS total[\s\S]*FROM snmp_trap_forwarding_rules/.test(sql),
    )).toBe(true);
  });

  test('slow DNS holds no transaction and a concurrent rule change fails the bound preflight', async () => {
    const connection = mockTransactionalConnection();
    let releaseLookup;
    const lookup = jest.spyOn(dns, 'lookup').mockImplementation(
      () => new Promise(resolve => { releaseLookup = resolve; }),
    );
    const concurrentlyChangedRule = {
      ...sampleRule,
      forward_to_url: 'https://9.9.9.9/changed-by-old-writer',
      configuration_reviewed_at: null,
    };
    connection.execute.mockImplementation((sql, params = []) => {
      if (/SELECT \* FROM `snmp_trap_forwarding_rules`/.test(sql)) {
        return Promise.resolve([[concurrentlyChangedRule]]);
      }
      return db.query(sql, params);
    });

    try {
      const response = request(app)
        .put('/api/v1/trap-forwarding-rules/1')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-Id', '10')
        .send({ forward_to_url: 'https://slow-dns.example.test/hook' })
        .then(result => result);
      for (let attempt = 0; attempt < 10 && !releaseLookup; attempt++) {
        await new Promise(resolve => global.setImmediate(resolve));
      }

      expect(releaseLookup).toEqual(expect.any(Function));
      expect(db.getConnection).not.toHaveBeenCalled();
      expect(connection.beginTransaction).not.toHaveBeenCalled();

      releaseLookup([{ address: '8.8.8.8', family: 4 }]);
      const res = await response;

      expect(res.status).toBe(409);
      expect(db.getConnection).toHaveBeenCalledTimes(1);
      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.execute.mock.calls.some(
        ([sql]) => /UPDATE `snmp_trap_forwarding_rules`/.test(sql),
      )).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });

  test('PUT rejects adding a second destination unless the old one is cleared', async () => {
    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ forward_to_email: 'noc@example.com' });

    expect(res.status).toBe(422);
  });

  test('PUT can switch destination when the previous target is explicitly cleared', async () => {
    const res = await request(app)
      .put('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ forward_to_url: null, forward_to_email: 'noc@example.com' });

    expect(res.status).toBe(200);
  });

  test('POST enforces the documented rule-name length', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ name: 'x'.repeat(201), forward_to_email: 'noc@example.com' });

    expect(res.status).toBe(422);
  });

  test('POST /api/v1/trap-forwarding-rules returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/trap-forwarding-rules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10')
      .send({ match_trap_type: 'linkDown' });

    expect(res.status).toBe(422);
  });

  test('DELETE /api/v1/trap-forwarding-rules/:id soft-deletes rule', async () => {
    const res = await request(app)
      .delete('/api/v1/trap-forwarding-rules/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', '10');

    expect([204, 404]).toContain(res.status);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/trap-forwarding-rules');
    expect(res.status).toBe(401);
  });
});
