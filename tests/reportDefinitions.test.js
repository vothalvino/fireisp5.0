// =============================================================================
// FireISP 5.0 — Report Definitions + On-Demand Generation Route Tests (§15 fix)
// =============================================================================
'use strict';

const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/config/database', () => ({
  query:         jest.fn(),
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

// Stub scheduledReportService so tests don't need real report data
jest.mock('../src/services/scheduledReportService', () => ({
  processScheduledReports: jest.fn(),
  runSchedule: jest.fn(),
  generateReportData: jest.fn().mockResolvedValue({ rows: [{ col: 'val' }] }),
  formatReport: jest.fn().mockResolvedValue({ buffer: Buffer.from('csv'), contentType: 'text/csv', extension: 'csv' }),
  toCSV: jest.fn().mockReturnValue('col\nval'),
  runOnDemand: jest.fn().mockResolvedValue({ reportId: 42, status: 'completed' }),
}));

const db = require('../src/config/database');

const sampleDef = {
  id: 1,
  organization_id: null,
  name: 'aging',
  category: 'financial',
  description: 'Accounts receivable aging',
  sql_template: null,
  parameters: null,
  is_system: 1,
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const sampleGenerated = {
  id: 42,
  organization_id: 1,
  report_def_name: 'aging',
  format: 'csv',
  status: 'completed',
  generated_at: '2026-06-12T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// GET /api/report-definitions
// =============================================================================

describe('GET /api/report-definitions', () => {
  it('returns 200 with list of definitions', async () => {
    db.queryReplica.mockResolvedValueOnce([[sampleDef]]);

    const res = await request(app)
      .get('/api/report-definitions')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('aging');
  });
});

// =============================================================================
// GET /api/report-definitions/:id
// =============================================================================

describe('GET /api/report-definitions/:id', () => {
  it('returns 200 with a single definition', async () => {
    db.queryReplica.mockResolvedValueOnce([[sampleDef]]);

    const res = await request(app)
      .get('/api/report-definitions/1')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('aging');
  });

  it('returns 404 when definition does not exist', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]); // empty

    const res = await request(app)
      .get('/api/report-definitions/999')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// POST /api/report-definitions
// =============================================================================

describe('POST /api/report-definitions', () => {
  it('creates a user-defined definition and returns 201', async () => {
    const newDef = { ...sampleDef, id: 2, organization_id: 1, is_system: 0, name: 'custom-monthly' };
    db.query.mockResolvedValueOnce([{ insertId: 2 }]);
    db.queryReplica.mockResolvedValueOnce([[newDef]]);

    const res = await request(app)
      .post('/api/report-definitions')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ name: 'custom-monthly', category: 'financial', description: 'My report' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('custom-monthly');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/report-definitions')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ category: 'financial' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when category is invalid', async () => {
    const res = await request(app)
      .post('/api/report-definitions')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ name: 'bad', category: 'invalid_cat' });

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// PUT /api/report-definitions/:id
// =============================================================================

describe('PUT /api/report-definitions/:id', () => {
  it('updates a user-created definition and returns 200', async () => {
    const userDef = { ...sampleDef, id: 2, organization_id: 1, is_system: 0, name: 'custom-monthly' };
    // First queryReplica: find existing (non-system, org-scoped)
    db.queryReplica
      .mockResolvedValueOnce([[userDef]])   // existence check
      .mockResolvedValueOnce([[{ ...userDef, description: 'Updated' }]]); // re-read after update
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .put('/api/report-definitions/2')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
  });

  it('returns 404 when definition is not found or is a system definition', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]); // not found

    const res = await request(app)
      .put('/api/report-definitions/1')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ description: 'Attempt to edit system def' });

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// DELETE /api/report-definitions/:id
// =============================================================================

describe('DELETE /api/report-definitions/:id', () => {
  it('soft-deletes a user-created definition and returns 204', async () => {
    const userDef = { ...sampleDef, id: 2, organization_id: 1, is_system: 0 };
    db.queryReplica.mockResolvedValueOnce([[userDef]]);
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .delete('/api/report-definitions/2')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(204);
  });

  it('returns 404 when not found', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]); // not found

    const res = await request(app)
      .delete('/api/report-definitions/999')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// POST /api/reports/generate  (reports.generate permission)
// =============================================================================

describe('POST /api/reports/generate', () => {
  it('returns 202 with generated_reports row on success', async () => {
    db.queryReplica.mockResolvedValueOnce([[sampleGenerated]]);

    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ report_def_name: 'aging', format: 'csv', parameters: {} });

    expect(res.status).toBe(202);
    expect(res.body.data.id).toBe(42);
    expect(res.body.data.status).toBe('completed');
  });

  it('returns 422 when report_def_name is missing', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ format: 'csv' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when format is invalid', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1')
      .send({ report_def_name: 'aging', format: 'docx' });

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// POST /api/scheduled-reports/:id/run  (reports.generate permission)
// =============================================================================

describe('POST /api/scheduled-reports/:id/run', () => {
  const sampleSchedule = {
    id: 5,
    organization_id: 1,
    report_def_name: 'aging',
    format: 'csv',
    parameters: null,
    recipients: null,
    cron_expression: '0 8 * * 1',
    is_enabled: 1,
    deleted_at: null,
  };

  it('returns 202 with generated_reports row when schedule exists', async () => {
    db.queryReplica
      .mockResolvedValueOnce([[sampleSchedule]])     // find schedule
      .mockResolvedValueOnce([[{ ...sampleGenerated, scheduled_report_id: 5 }]]); // re-read generated

    const res = await request(app)
      .post('/api/scheduled-reports/5/run')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(202);
    expect(res.body.data.id).toBe(42);
  });

  it('returns 404 when scheduled report does not exist', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]); // not found

    const res = await request(app)
      .post('/api/scheduled-reports/999/run')
      .set('Authorization', 'Bearer test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(404);
  });
});
