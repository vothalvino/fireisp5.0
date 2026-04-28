// =============================================================================
// FireISP 5.0 — PROFECO Complaint Route + Service Tests (P3.12)
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery        = jest.fn();
const mockQueryReplica = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  mockQueryReplica,
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Middleware mocks
// ---------------------------------------------------------------------------
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user   = { id: 1, email: 'admin@test.com', role: 'admin' };
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
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const app           = require('../src/app');
const profecoService = require('../src/services/profecoService');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COMPLAINT_ROW = {
  id: 1,
  organization_id: 1,
  ticket_id: null,
  client_id: null,
  folio_profeco: 'CONCILIANET-2026-001',
  consumer_name: 'Juan Pérez García',
  consumer_email: 'juan@example.com',
  consumer_phone: '5512345678',
  service_type: 'internet',
  category: 'calidad_servicio',
  description: 'El servicio de internet tiene interrupciones frecuentes.',
  resolution_requested: 'Reparación del servicio o cancelación sin penalización.',
  company_response: null,
  status: 'recibida',
  reported_at: '2026-01-15T00:00:00.000Z',
  resolved_at: null,
  submitted_by: 1,
  created_at: '2026-01-15T10:00:00.000Z',
  updated_at: '2026-01-15T10:00:00.000Z',
  deleted_at: null,
};

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('PROFECO complaint routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryReplica.mockReset();
  });

  describe('GET /api/v1/profeco-complaints', () => {
    test('returns 200 with paginated list', async () => {
      mockQuery
        .mockResolvedValueOnce([[COMPLAINT_ROW]])             // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);             // count

      const res = await request(app).get('/api/v1/profeco-complaints');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].consumer_name).toBe('Juan Pérez García');
    });
  });

  describe('GET /api/v1/profeco-complaints/:id', () => {
    test('returns 200 for existing complaint', async () => {
      mockQuery.mockResolvedValueOnce([[COMPLAINT_ROW]]);

      const res = await request(app).get('/api/v1/profeco-complaints/1');
      expect(res.status).toBe(200);
      expect(res.body.data.folio_profeco).toBe('CONCILIANET-2026-001');
    });

    test('returns 404 for unknown complaint', async () => {
      mockQuery.mockResolvedValueOnce([[undefined]]);

      const res = await request(app).get('/api/v1/profeco-complaints/9999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/profeco-complaints', () => {
    test('creates a complaint and returns 201', async () => {
      mockQuery
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([[{ ...COMPLAINT_ROW, id: 2 }]]);

      const res = await request(app)
        .post('/api/v1/profeco-complaints')
        .send({
          consumer_name: 'María López',
          description:   'Cobro duplicado en factura de enero.',
          service_type:  'internet',
          category:      'facturacion',
        });

      expect(res.status).toBe(201);
    });

    test('returns 422 when consumer_name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/profeco-complaints')
        .send({ description: 'Missing name' });

      expect(res.status).toBe(422);
    });

    test('returns 422 when description is missing', async () => {
      const res = await request(app)
        .post('/api/v1/profeco-complaints')
        .send({ consumer_name: 'Test User' });

      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /api/v1/profeco-complaints/:id', () => {
    test('partial update sets company_response', async () => {
      mockQuery
        .mockResolvedValueOnce([[COMPLAINT_ROW]])                        // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }])                    // UPDATE
        .mockResolvedValueOnce([[{ ...COMPLAINT_ROW, company_response: 'Revisado.' }]]);

      const res = await request(app)
        .patch('/api/v1/profeco-complaints/1')
        .send({ company_response: 'Revisado.' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/v1/profeco-complaints/:id', () => {
    test('soft-deletes and returns 204', async () => {
      mockQuery
        .mockResolvedValueOnce([[COMPLAINT_ROW]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app).delete('/api/v1/profeco-complaints/1');
      expect(res.status).toBe(204);
    });
  });
});

// ---------------------------------------------------------------------------
// Export endpoint tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/profeco-complaints/export', () => {
  beforeEach(() => {
    mockQueryReplica.mockReset();
  });

  test('returns JSON report when format=json (default)', async () => {
    mockQueryReplica.mockResolvedValueOnce([[
      { ...COMPLAINT_ROW, client_name: null, client_email: null, ticket_title: null,
        submitted_by_first_name: 'Admin', submitted_by_last_name: 'User' },
    ]]);

    const res = await request(app).get('/api/v1/profeco-complaints/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.meta.totalComplaints).toBe(1);
    expect(res.body.meta.summary.recibida).toBe(1);
    expect(res.body.complaints).toHaveLength(1);
  });

  test('returns CSV when format=csv', async () => {
    mockQueryReplica.mockResolvedValueOnce([[
      { ...COMPLAINT_ROW, client_name: null, client_email: null, ticket_title: null,
        submitted_by_first_name: 'Admin', submitted_by_last_name: 'User' },
    ]]);

    const res = await request(app).get('/api/v1/profeco-complaints/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('consumer_name');
    expect(res.text).toContain('Juan Pérez García');
  });

  test('CSV is empty string when no complaints match', async () => {
    mockQueryReplica.mockResolvedValueOnce([[]]);

    const res = await request(app).get('/api/v1/profeco-complaints/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  test('filters by date_from and date_to', async () => {
    mockQueryReplica.mockResolvedValueOnce([[]]);

    await request(app).get('/api/v1/profeco-complaints/export?date_from=2026-01-01&date_to=2026-03-31');
    const [sql, params] = mockQueryReplica.mock.calls[0];
    expect(sql).toContain('reported_at >= ?');
    expect(sql).toContain('reported_at <= ?');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-03-31');
  });

  test('filters by status', async () => {
    mockQueryReplica.mockResolvedValueOnce([[]]);

    await request(app).get('/api/v1/profeco-complaints/export?status=resuelta');
    const [sql, params] = mockQueryReplica.mock.calls[0];
    expect(sql).toContain('status = ?');
    expect(params).toContain('resuelta');
  });

  test('JSON meta includes generatedAt ISO timestamp', async () => {
    mockQueryReplica.mockResolvedValueOnce([[]]);

    const before = Date.now();
    const res = await request(app).get('/api/v1/profeco-complaints/export');
    const after  = Date.now();
    const ts = new Date(res.body.meta.generatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after   + 1000);
  });
});

// ---------------------------------------------------------------------------
// profecoService unit tests
// ---------------------------------------------------------------------------

describe('profecoService.toCsv()', () => {
  test('returns empty string for empty array', () => {
    expect(profecoService.toCsv([])).toBe('');
  });

  test('produces header row and data row', () => {
    const csv = profecoService.toCsv([{ id: 1, name: 'Test', status: 'recibida' }]);
    expect(csv).toContain('id,name,status');
    expect(csv).toContain('1,Test,recibida');
  });

  test('escapes values containing commas', () => {
    const csv = profecoService.toCsv([{ id: 1, desc: 'hello, world' }]);
    expect(csv).toContain('"hello, world"');
  });

  test('escapes values containing double quotes', () => {
    const csv = profecoService.toCsv([{ id: 1, desc: 'say "hi"' }]);
    expect(csv).toContain('"say ""hi"""');
  });
});
