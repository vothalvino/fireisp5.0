// =============================================================================
// FireISP 5.0 — DSAR Endpoint Tests (P1.7)
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mock database — returns minimal but realistic rows for every query.
// The DSAR route issues 9 sequential queries; we use mockResolvedValueOnce to
// return the right shape for each.
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  query:       mockQuery,
  execute:     jest.fn(),
  getConnection: jest.fn(),
  close:       jest.fn(),
  pool:        { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Mock auth middleware so we can inject a fake org + user in tests.
// ---------------------------------------------------------------------------
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user      = { id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId    = 1;
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
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const app = require('../src/app');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CLIENT_ROW = {
  id: 42, name: 'Juan Pérez', email: 'juan@example.com', phone: '55-1234-5678',
  client_type: 'personal', locale: 'MX', tax_id: 'PEPJ800101XXX',
  address: 'Calle 1 #10', city: 'CDMX', state: 'CDMX', zip_code: '06600',
  country: 'MX', notes: null, status: 'active',
  created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-02T00:00:00.000Z',
};

function setupMocks(clientRow) {
  mockQuery
    // 1. client row
    .mockResolvedValueOnce([[clientRow]])
    // 2. contacts
    .mockResolvedValueOnce([[{ id: 1, name: 'María Pérez', email: 'm@ex.com', phone: null, role: 'billing', created_at: '2024-01-01' }]])
    // 3. mxProfile
    .mockResolvedValueOnce([[{ id: 1, rfc: 'PEPJ800101XXX', curp: null, regimen_fiscal: '612', uso_cfdi: 'G03', zip_code: '06600', created_at: '2024-01-01' }]])
    // 4. contracts
    .mockResolvedValueOnce([[{ id: 10, plan_id: 2, status: 'active', start_date: '2024-01-01', end_date: null, monthly_price: '499.00', created_at: '2024-01-01' }]])
    // 5. invoices
    .mockResolvedValueOnce([[{ id: 100, invoice_number: 'INV-0001', total: '499.00', status: 'paid', due_date: '2024-02-01', issued_at: '2024-01-15', created_at: '2024-01-15' }]])
    // 6. payments
    .mockResolvedValueOnce([[{ id: 200, amount: '499.00', payment_method: 'cash', status: 'confirmed', paid_at: '2024-02-01', created_at: '2024-02-01' }]])
    // 7. tickets
    .mockResolvedValueOnce([[{ id: 300, subject: 'No internet', status: 'closed', priority: 'medium', created_at: '2024-03-01', resolved_at: '2024-03-02' }]])
    // 8. connectionLogs
    .mockResolvedValueOnce([[{ id: 400, username: 'juan_pppoe', ip_address: '192.168.1.1', mac_address: 'AA:BB:CC:DD:EE:FF', nas_id: 1, session_start: '2024-04-01', session_stop: '2024-04-01', bytes_in: 1000, bytes_out: 2000 }]])
    // 9. ipAssignments
    .mockResolvedValueOnce([[{ id: 500, ip_address: '192.168.1.1', type: 'dynamic', status: 'assigned', assigned_at: '2024-01-01', released_at: null }]])
    // 10. aiReplyLogs
    .mockResolvedValueOnce([[{ id: 1, ticket_id: 300, action: 'sent', confidence: 0.91, classification: 'connectivity', draft_text: 'Dear client,', final_text: 'Dear client, issue resolved.', created_at: '2024-03-01T10:00:00Z' }]]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/dsar/clients/:id', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns 200 with all PII sections for a known client', async () => {
    setupMocks(CLIENT_ROW);

    const res = await request(app).get('/api/v1/dsar/clients/42');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      clientId:      42,
      organizationId: 1,
      version:       '1.1',
      requestedBy:   'admin@test.com',
    });
    expect(res.body.meta.generatedAt).toBeTruthy();

    const { data } = res.body;
    expect(data.client.name).toBe('Juan Pérez');
    expect(data.contacts).toHaveLength(1);
    expect(data.mxProfile).not.toBeNull();
    expect(data.contracts).toHaveLength(1);
    expect(data.invoices).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
    expect(data.tickets).toHaveLength(1);
    expect(data.connectionLogs).toHaveLength(1);
    expect(data.ipAssignments).toHaveLength(1);
    expect(data.aiReplyLogs).toHaveLength(1);
    expect(data.aiReplyLogs[0].action).toBe('sent');
    // Internal fields must NOT be exported
    expect(data.aiReplyLogs[0]).not.toHaveProperty('context_snapshot');
    expect(data.aiReplyLogs[0]).not.toHaveProperty('prompt_hash');
  });

  test('returns 404 when the client does not exist in the org', async () => {
    // First query returns empty row set → NotFoundError
    mockQuery
      .mockResolvedValueOnce([[undefined]])
      // remaining 8 queries not reached but mock them to avoid unhandled
      .mockResolvedValue([[]]);

    const res = await request(app).get('/api/v1/dsar/clients/9999');
    expect(res.status).toBe(404);
  });

  test('returns null mxProfile when client has no MX profile', async () => {
    setupMocks(CLIENT_ROW);
    // Override query 3 (mxProfile) to return empty
    mockQuery
      .mockReset()
      .mockResolvedValueOnce([[CLIENT_ROW]])           // client
      .mockResolvedValueOnce([[]])                      // contacts
      .mockResolvedValueOnce([[undefined]])             // mxProfile → null
      .mockResolvedValueOnce([[]])                      // contracts
      .mockResolvedValueOnce([[]])                      // invoices
      .mockResolvedValueOnce([[]])                      // payments
      .mockResolvedValueOnce([[]])                      // tickets
      .mockResolvedValueOnce([[]])                      // connectionLogs
      .mockResolvedValueOnce([[]])                      // ipAssignments
      .mockResolvedValueOnce([[]]);                     // aiReplyLogs

    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.data.mxProfile).toBeNull();
  });

  test('response meta contains generatedAt ISO timestamp', async () => {
    setupMocks(CLIENT_ROW);
    const before = Date.now();
    const res = await request(app).get('/api/v1/dsar/clients/42');
    const after  = Date.now();
    expect(res.status).toBe(200);
    const ts = new Date(res.body.meta.generatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after   + 1000);
  });

  test('includes connection logs up to 500 rows', async () => {
    // Build 5 fake log rows to verify array is forwarded correctly.
    const logs = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, username: `u${i}`, ip_address: `10.0.0.${i}`, mac_address: null,
      nas_id: 1, session_start: '2024-04-01', session_stop: '2024-04-01',
      bytes_in: 100, bytes_out: 200,
    }));

    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[undefined]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([logs])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);   // aiReplyLogs

    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.data.connectionLogs).toHaveLength(5);
  });

  test('includes aiReplyLogs section with draft/final text but without internal fields', async () => {
    const aiLog = {
      id: 1, ticket_id: 300, action: 'edited', confidence: 0.88,
      classification: 'billing', draft_text: 'Draft reply.', final_text: 'Final reply.',
      created_at: '2024-03-02T09:00:00Z',
    };
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])    // client
      .mockResolvedValueOnce([[]])              // contacts
      .mockResolvedValueOnce([[undefined]])     // mxProfile
      .mockResolvedValueOnce([[]])              // contracts
      .mockResolvedValueOnce([[]])              // invoices
      .mockResolvedValueOnce([[]])              // payments
      .mockResolvedValueOnce([[]])              // tickets
      .mockResolvedValueOnce([[]])              // connectionLogs
      .mockResolvedValueOnce([[]])              // ipAssignments
      .mockResolvedValueOnce([[aiLog]]);        // aiReplyLogs

    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.data.aiReplyLogs).toHaveLength(1);
    expect(res.body.data.aiReplyLogs[0].action).toBe('edited');
    expect(res.body.data.aiReplyLogs[0].draft_text).toBe('Draft reply.');
    expect(res.body.data.aiReplyLogs[0].final_text).toBe('Final reply.');
    // Internal fields must not be present (they were excluded by the SELECT)
    expect(res.body.data.aiReplyLogs[0]).not.toHaveProperty('context_snapshot');
    expect(res.body.data.aiReplyLogs[0]).not.toHaveProperty('prompt_hash');
  });

  test('aiReplyLogs is empty array when client has no AI interactions', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[undefined]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);  // aiReplyLogs empty

    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(200);
    expect(res.body.data.aiReplyLogs).toEqual([]);
  });

  test('returns 500 when a DB query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await request(app).get('/api/v1/dsar/clients/42');
    expect(res.status).toBe(500);
  });
});
