// =============================================================================
// FireISP 5.0 — Section 15 Route Tests (Reporting & Analytics)
// Covers: /reports (new §15 endpoints), /scheduled-reports, /dashboard-widgets,
//         /custom-reports (including execute)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

/** Standard db mock: auth user lookup + permissions + audit log insert. */
function mockDbAuth() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('report')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    return Promise.resolve([[]]);
  });

  db.queryReplica.mockImplementation((sql) => {
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'reports.view' }]]);
    }
    return Promise.resolve([[]]);
  });
}

// =============================================================================
// /api/v1/reports — new §15 endpoints
// =============================================================================

describe('GET /api/v1/reports/revenue-by-period', () => {
  beforeEach(() => {
    mockDbAuth();
    db.queryReplica.mockResolvedValue([[{ month: '2026-01', revenue: '1000.00', invoice_count: 5 }]]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with revenue data', async () => {
    const res = await request(app)
      .get('/api/v1/reports/revenue-by-period?period=monthly')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/reports/revenue-by-plan', () => {
  beforeEach(() => {
    mockDbAuth();
    db.queryReplica.mockResolvedValue([[{ plan_name: 'Basic', revenue: '5000.00', subscriber_count: 10 }]]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with plan revenue data', async () => {
    const res = await request(app)
      .get('/api/v1/reports/revenue-by-plan')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/reports/subscriber-counts', () => {
  beforeEach(() => {
    mockDbAuth();
    db.queryReplica.mockResolvedValue([[{ month: '2026-01', active_count: 100, suspended_count: 5 }]]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with subscriber count data', async () => {
    const res = await request(app)
      .get('/api/v1/reports/subscriber-counts')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/reports/arpu', () => {
  beforeEach(() => {
    mockDbAuth();
    db.queryReplica.mockResolvedValue([[{ month: '2026-01', arpu: '250.00', subscribers: 40 }]]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with ARPU data', async () => {
    const res = await request(app)
      .get('/api/v1/reports/arpu')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/reports/data-retention-compliance', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with compliance data', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
    db.queryReplica
      .mockResolvedValueOnce([[{ id: 1, name: 'reports.view' }]])  // permissions
      .mockResolvedValueOnce([[{ oldest_invoice: '2020-01-01', record_count: 1000 }]])
      .mockResolvedValueOnce([[{ oldest_audit: '2020-01-01', record_count: 5000 }]])
      .mockResolvedValueOnce([[{ oldest_session: '2023-01-01', record_count: 100 }]]);

    const res = await request(app)
      .get('/api/v1/reports/data-retention-compliance')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

// =============================================================================
// /api/v1/reports/:report/export
// =============================================================================

describe('GET /api/v1/reports/:report/export', () => {
  beforeEach(() => {
    mockDbAuth();
    db.queryReplica.mockResolvedValue([[{ client_id: 1, days_overdue: 5, aging_bucket: '1-30', total: '100.00', currency: 'MXN' }]]);
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns CSV for aging report', async () => {
    const res = await request(app)
      .get('/api/v1/reports/aging/export?format=csv')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('returns 422 for unsupported format', async () => {
    const res = await request(app)
      .get('/api/v1/reports/aging/export?format=xml')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /api/v1/scheduled-reports
// =============================================================================

const sampleSchedule = {
  id: 1,
  organization_id: 10,
  report_def_name: 'aging',
  format: 'csv',
  cron_expression: '0 8 * * 1',
  is_enabled: 1,
  created_by: 1,
  deleted_at: null,
};

function mockScheduledReportsDb() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('report')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO scheduled_reports')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE scheduled_reports')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    return Promise.resolve([[]]);
  });

  db.queryReplica.mockImplementation((sql) => {
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'reports.schedule' }]]);
    }
    if (typeof sql === 'string' && sql.includes('scheduled_reports')) {
      return Promise.resolve([[sampleSchedule]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/scheduled-reports', () => {
  beforeEach(() => { mockScheduledReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with schedule list', async () => {
    const res = await request(app)
      .get('/api/v1/scheduled-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/scheduled-reports/:id', () => {
  beforeEach(() => { mockScheduledReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with a single schedule', async () => {
    const res = await request(app)
      .get('/api/v1/scheduled-reports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('report_def_name', 'aging');
  });

  it('returns 404 when not found', async () => {
    db.queryReplica.mockImplementation((sql) => {
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'reports.schedule' }]]);
      }
      return Promise.resolve([[]]);
    });
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('report')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/scheduled-reports/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/scheduled-reports', () => {
  beforeEach(() => { mockScheduledReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a scheduled report and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ report_def_name: 'aging', format: 'csv' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when report_def_name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ format: 'csv' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/scheduled-reports/:id', () => {
  beforeEach(() => { mockScheduledReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates a schedule and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/scheduled-reports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ is_enabled: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('DELETE /api/v1/scheduled-reports/:id', () => {
  beforeEach(() => { mockScheduledReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('soft-deletes a schedule and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/scheduled-reports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});

// =============================================================================
// /api/v1/dashboard-widgets
// =============================================================================

const sampleWidget = {
  id: 1,
  user_id: 1,
  organization_id: 10,
  widget_type: 'revenue_chart',
  title: 'Revenue Chart',
  position_x: 0,
  position_y: 0,
  width: 4,
  height: 3,
  config: null,
  deleted_at: null,
};

function mockWidgetsDb() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('widget')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO dashboard_widgets')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE dashboard_widgets')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    return Promise.resolve([[]]);
  });

  db.queryReplica.mockImplementation((sql) => {
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'dashboard_widgets.view' }]]);
    }
    if (typeof sql === 'string' && sql.includes('dashboard_widgets')) {
      return Promise.resolve([[sampleWidget]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/dashboard-widgets', () => {
  beforeEach(() => { mockWidgetsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with widget list', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard-widgets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/dashboard-widgets', () => {
  beforeEach(() => { mockWidgetsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a widget and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/dashboard-widgets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ widget_type: 'revenue_chart', title: 'Revenue Chart' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when title is missing', async () => {
    const res = await request(app)
      .post('/api/v1/dashboard-widgets')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ widget_type: 'revenue_chart' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/dashboard-widgets/:id', () => {
  beforeEach(() => { mockWidgetsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates a widget and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/dashboard-widgets/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ title: 'Updated Chart' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('DELETE /api/v1/dashboard-widgets/:id', () => {
  beforeEach(() => { mockWidgetsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('soft-deletes a widget and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/dashboard-widgets/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});

describe('PUT /api/v1/dashboard-widgets/batch', () => {
  beforeEach(() => { mockWidgetsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates multiple widget positions and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/dashboard-widgets/batch')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ widgets: [{ id: 1, position_x: 2, position_y: 1, width: 4, height: 3 }] });
    expect(res.status).toBe(200);
  });

  it('returns 422 when widgets array is missing', async () => {
    const res = await request(app)
      .put('/api/v1/dashboard-widgets/batch')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// /api/v1/custom-reports
// =============================================================================

const sampleCustomReport = {
  id: 1,
  organization_id: 10,
  name: 'Active Clients',
  query_type: 'sql',
  sql_query: 'SELECT id, name FROM clients WHERE organization_id = 10 LIMIT 100',
  is_public: 1,
  created_by: 1,
  deleted_at: null,
};

function mockCustomReportsDb() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('report')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO custom_reports')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (typeof sql === 'string' && sql.includes('UPDATE custom_reports')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    return Promise.resolve([[]]);
  });

  db.queryReplica.mockImplementation((sql) => {
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'custom_reports.view' }]]);
    }
    if (typeof sql === 'string' && sql.includes('custom_reports')) {
      return Promise.resolve([[sampleCustomReport]]);
    }
    // Default: session timeout set + query execution
    return Promise.resolve([[{ id: 1, name: 'Test Client' }]]);
  });
}

describe('GET /api/v1/custom-reports', () => {
  beforeEach(() => { mockCustomReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with custom report list', async () => {
    const res = await request(app)
      .get('/api/v1/custom-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('GET /api/v1/custom-reports/:id', () => {
  beforeEach(() => { mockCustomReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with a single custom report', async () => {
    const res = await request(app)
      .get('/api/v1/custom-reports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'Active Clients');
  });

  it('returns 404 when not found', async () => {
    db.queryReplica.mockImplementation((sql) => {
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'custom_reports.view' }]]);
      }
      return Promise.resolve([[]]);
    });
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.toLowerCase().includes('report')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/custom-reports/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/custom-reports', () => {
  beforeEach(() => { mockCustomReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates a custom report and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/custom-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Active Clients', query_type: 'sql', sql_query: 'SELECT id FROM clients LIMIT 10' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/custom-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ query_type: 'sql', sql_query: 'SELECT id FROM clients' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when sql_query is not SELECT', async () => {
    const res = await request(app)
      .post('/api/v1/custom-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Bad Query', query_type: 'sql', sql_query: 'DROP TABLE clients' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when sql_query contains semicolons', async () => {
    const res = await request(app)
      .post('/api/v1/custom-reports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Injection', query_type: 'sql', sql_query: 'SELECT 1; DROP TABLE clients' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/custom-reports/:id', () => {
  beforeEach(() => { mockCustomReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('soft-deletes and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/custom-reports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(204);
  });
});

describe('POST /api/v1/custom-reports/:id/execute', () => {
  beforeEach(() => { mockCustomReportsDb(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('executes a SQL report and returns rows with meta', async () => {
    const res = await request(app)
      .post('/api/v1/custom-reports/1/execute')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('report_id', 1);
    expect(res.body.meta).toHaveProperty('name', 'Active Clients');
  });
});
