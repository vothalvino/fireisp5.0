// =============================================================================
// FireISP 5.0 — Additional Route Coverage Tests
// =============================================================================
// Tests for routes that are not yet covered by existing integration tests:
// bulk, metrics, alerts, roles, facturasPublicas, satCatalogs, events,
// firerelay, pdf, quotes, payments, invoices, twoFactor, clients (sub-routes)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/middleware/orgLocale', () => ({
  requireMxLocale: (_req, _res, next) => next(),
}));
jest.mock('../src/models/Quote');
jest.mock('../src/models/Invoice');
jest.mock('../src/models/Payment');
jest.mock('../src/models/Client');
jest.mock('../src/services/pdfService');
jest.mock('../src/services/twoFactorService');
jest.mock('../src/services/alertService');
jest.mock('../src/services/billingService');
jest.mock('../src/services/suspensionService');
jest.mock('../src/services/emailTransport', () => ({
  init: jest.fn(),
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  processQueue: jest.fn(),
}));
jest.mock('../src/views/emailTemplates', () => ({
  paymentReceiptEmail: jest.fn().mockReturnValue({ subject: 'Payment Confirmed', html: '<p>receipt</p>' }),
  invoiceEmail: jest.fn().mockReturnValue({ subject: 'Invoice', html: '<p>invoice</p>' }),
  passwordResetEmail: jest.fn().mockReturnValue({ subject: 'Reset', html: '<p>reset</p>' }),
  emailVerificationEmail: jest.fn().mockReturnValue({ subject: 'Verify', html: '<p>verify</p>' }),
  suspensionWarningEmail: jest.fn().mockReturnValue({ subject: 'Warning', html: '<p>warning</p>' }),
  serviceSuspendedEmail: jest.fn().mockReturnValue({ subject: 'Suspended', html: '<p>suspended</p>' }),
  outageNotificationEmail: jest.fn().mockReturnValue({ subject: 'Outage', html: '<p>outage</p>' }),
}));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const Quote = require('../src/models/Quote');
const Invoice = require('../src/models/Invoice');
const Payment = require('../src/models/Payment');
const Client = require('../src/models/Client');
const pdfService = require('../src/services/pdfService');
const twoFactorService = require('../src/services/twoFactorService');
const alertService = require('../src/services/alertService');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

function mockConnection() {
  const conn = {
    query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    execute: jest.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// BULK ROUTES — /api/bulk
// =============================================================================
describe('Bulk Routes — /api/bulk', () => {
  describe('POST /api/bulk/invoices/generate', () => {
    test('success — generates invoices for contract_ids', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/bulk/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [1, 2, 3] });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(3);
    });

    test('validation — rejects empty array', async () => {
      mockAuthUser();
      const res = await request(app)
        .post('/api/bulk/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('validation — rejects >500 contracts', async () => {
      mockAuthUser();
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/bulk/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: ids });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/500/);
    });

    test('handles partial failures', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockRejectedValueOnce(new Error('Duplicate'))
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/bulk/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [1, 2, 3] });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(2);
      expect(res.body.data.failed).toBe(1);
    });
  });

  describe('POST /api/bulk/suspend', () => {
    test('success — suspends contracts', async () => {
      mockAuthUser();
      // SELECT id, status FROM contracts — each contract exists and is active
      db.query.mockResolvedValue([[{ id: 10, status: 'active', organization_id: 1 }]]);
      suspensionService.suspendContract.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/bulk/suspend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [10, 20], reason: 'Non-payment' });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(2);
      expect(suspensionService.suspendContract).toHaveBeenCalledTimes(2);
    });

    test('validation — rejects missing contract_ids', async () => {
      mockAuthUser();
      const res = await request(app)
        .post('/api/bulk/suspend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    test('validation — rejects >500 contracts', async () => {
      mockAuthUser();
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/bulk/suspend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: ids });

      expect(res.status).toBe(400);
    });

    test('reports not found contracts as failed', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]); // SELECT finds no matching contract

      const res = await request(app)
        .post('/api/bulk/suspend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [999] });

      expect(res.status).toBe(200);
      expect(res.body.data.failed).toBe(1);
      expect(suspensionService.suspendContract).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/bulk/email', () => {
    test('success — queues emails for clients', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[
        { id: 1, email: 'a@test.com', first_name: 'A', last_name: 'B' },
        { id: 2, email: 'b@test.com', first_name: 'C', last_name: 'D' },
      ]]);

      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [1, 2], subject: 'Test', body: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(2);
    });

    test('validation — rejects missing subject', async () => {
      mockAuthUser();
      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [1], body: 'Hello' });

      expect(res.status).toBe(422);
    });

    test('validation — rejects missing body', async () => {
      mockAuthUser();
      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [1], subject: 'Test' });

      expect(res.status).toBe(422);
    });

    test('validation — rejects empty client_ids', async () => {
      mockAuthUser();
      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [], subject: 'Test', body: 'Hello' });

      expect(res.status).toBe(400);
    });

    test('validation — rejects >1000 clients', async () => {
      mockAuthUser();
      const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: ids, subject: 'Test', body: 'Hello' });

      expect(res.status).toBe(400);
    });

    // RBAC hardening: /bulk/email must be gated by campaigns.create (a write
    // permission), not clients.view (a read permission nearly every seeded
    // role — including technician and readonly — holds).
    describe('RBAC — campaigns.create required (not clients.view)', () => {
      function mockNonAdminUser(role) {
        User.findById.mockResolvedValue({
          id: 2,
          email: 'nonadmin@example.com',
          status: 'active',
          role, // legacy users.role — anything other than 'admin' goes through User.getPermissions
          organization_id: 1,
        });
      }

      test('403 for a user with only clients.view (e.g. technician/readonly)', async () => {
        mockNonAdminUser('technician');
        User.getPermissions.mockResolvedValue(['clients.view']);

        const res = await request(app)
          .post('/api/bulk/email')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ client_ids: [1], subject: 'Test', body: 'Hello' });

        expect(res.status).toBe(403);
      });

      test('200 for a user with campaigns.create (e.g. support/billing)', async () => {
        mockNonAdminUser('support');
        User.getPermissions.mockResolvedValue(['campaigns.create']);
        db.query.mockResolvedValue([[{ id: 1, email: 'a@test.com', first_name: 'A', last_name: 'B' }]]);

        const res = await request(app)
          .post('/api/bulk/email')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ client_ids: [1], subject: 'Test', body: 'Hello' });

        expect(res.status).toBe(200);
        expect(res.body.data.queued).toBe(1);
      });
    });
  });
});

// =============================================================================
// METRICS ROUTE — /metrics
// =============================================================================
describe('Metrics Route — /metrics', () => {
  test('GET /metrics returns Prometheus text format', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('process_uptime_seconds');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('process_resident_memory_bytes');
  });
});

// =============================================================================
// ALERT ROUTES — /api/alerts
// =============================================================================
describe('Alert Routes — /api/alerts', () => {
  describe('GET /api/alerts/rules', () => {
    test('success — lists alert rules', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'High CPU' }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/alerts/rules')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(50);
    });
  });

  describe('POST /api/alerts/rules', () => {
    test('success — creates an alert rule', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([[{ id: 10, name: 'High CPU', metric: 'cpu_percent' }]]);

      const res = await request(app)
        .post('/api/alerts/rules')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'High CPU', metric: 'cpu_percent', threshold: 90 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(10);
    });
  });

  describe('PUT /api/alerts/rules/:id', () => {
    test('success — updates an alert rule', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'Updated' }]]);

      const res = await request(app)
        .put('/api/alerts/rules/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
    });

    test('returns 400 when no fields to update', async () => {
      mockAuthUser();
      const res = await request(app)
        .put('/api/alerts/rules/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/alerts/rules/:id', () => {
    test('success — deletes an alert rule', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/alerts/rules/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });

    test('returns 404 for non-existent rule', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 0 }]);

      const res = await request(app)
        .delete('/api/alerts/rules/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/alerts/events', () => {
    test('success — returns alert history', async () => {
      mockAuthUser();
      alertService.getAlertHistory.mockResolvedValue({
        data: [{ id: 1, severity: 'critical' }],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });

      const res = await request(app)
        .get('/api/alerts/events')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('POST /api/alerts/events/:id/acknowledge', () => {
    test('success — acknowledges an alert', async () => {
      mockAuthUser();
      alertService.acknowledgeAlert.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/alerts/events/1/acknowledge')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.acknowledged).toBe(true);
    });
  });

  describe('POST /api/alerts/evaluate', () => {
    test('success — triggers alert evaluation', async () => {
      mockAuthUser();
      alertService.evaluateAlerts.mockResolvedValue({ checked: 5, triggered: 1 });

      const res = await request(app)
        .post('/api/alerts/evaluate')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.checked).toBe(5);
    });
  });
});

// =============================================================================
// ROLE ROUTES — /api/roles
// =============================================================================
describe('Role Routes — /api/roles', () => {
  describe('GET /api/roles', () => {
    test('success — lists roles', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'admin' }, { id: 2, name: 'support' }]])
        .mockResolvedValueOnce([[{ total: 2 }]]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(2);
      expect(res.body.meta.page).toBe(1);
    });
  });

  describe('GET /api/roles/permissions', () => {
    test('success — lists the permission catalogue', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([
        [
          { id: 1, slug: 'clients.view', description: 'View clients', module: 'clients' },
          { id: 2, slug: 'invoices.create', description: 'Create invoices', module: 'billing' },
        ],
      ]);

      const res = await request(app)
        .get('/api/roles/permissions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].slug).toBe('clients.view');
    });
  });

  describe('GET /api/roles/:id', () => {
    test('success — returns role with permissions', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'admin' }]])
        .mockResolvedValueOnce([[{ id: 1, slug: 'clients.view' }]]);

      const res = await request(app)
        .get('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('admin');
      expect(res.body.data.permissions).toHaveLength(1);
    });

    test('returns 404 for non-existent role', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]);

      const res = await request(app)
        .get('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/roles', () => {
    test('success — creates a role', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 5 }])
        .mockResolvedValueOnce([[{ id: 5, name: 'New Role' }]]);

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Role', description: 'A new role', kind: 'support' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(5);
    });
  });

  describe('PUT /api/roles/:id', () => {
    test('success — updates a role', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'Old', kind: 'support', is_system: 0 }]])  // pre-fetch (378 guard)
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'Updated' }]]);

      const res = await request(app)
        .put('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated', description: 'Updated description' });

      expect(res.status).toBe(200);
    });

    test('returns 404 when role not found', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]]);  // pre-fetch — not found (378 guard runs first)

      const res = await request(app)
        .put('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated', description: 'Desc' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/roles/:id', () => {
    test('success — deletes a role', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'test', is_system: 0 }]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])          // COUNT assigned users (378 guard)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });

    test('returns 404 for non-existent role', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]);

      const res = await request(app)
        .delete('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/roles/:id/permissions', () => {
    test('success — assigns a permission', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, slug: 'clients.view' }]]);

      const res = await request(app)
        .post('/api/roles/1/permissions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ permission_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('DELETE /api/roles/:id/permissions/:permissionId', () => {
    test('success — removes a permission', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/roles/1/permissions/5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });
});

// =============================================================================
// FACTURAS PÚBLICAS ROUTES — /api/facturas-publicas
// =============================================================================
describe('Facturas Públicas Routes — /api/facturas-publicas', () => {
  describe('GET /api/facturas-publicas', () => {
    test('success — lists facturas', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, total: '100.00' }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/facturas-publicas')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.page).toBe(1);
    });
  });

  describe('GET /api/facturas-publicas/:id', () => {
    test('success — returns a factura', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, total: '100.00' }]]);

      const res = await request(app)
        .get('/api/facturas-publicas/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
    });

    test('returns 404 when not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]);

      const res = await request(app)
        .get('/api/facturas-publicas/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/facturas-publicas', () => {
    test('success — creates a factura', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 5 }])
        .mockResolvedValueOnce([[{ id: 5, total: '200.00' }]]);

      const res = await request(app)
        .post('/api/facturas-publicas')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ periodicidad: '01', meses: '01', anio: 2024, subtotal: 200, total: 200, total_impuestos: 0 });

      expect(res.status).toBe(201);
    });
  });

  describe('PUT /api/facturas-publicas/:id', () => {
    test('success — updates a factura', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 1, total: '300.00' }]]);

      const res = await request(app)
        .put('/api/facturas-publicas/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ total: 300 });

      expect(res.status).toBe(200);
    });

    test('returns 404 when not found', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .put('/api/facturas-publicas/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ total: 300 });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/facturas-publicas/:id/items', () => {
    test('success — lists items', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, invoice_id: 5 }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/facturas-publicas/1/items')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('POST /api/facturas-publicas/:id/items', () => {
    test('success — links an invoice', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 3 }])
        .mockResolvedValueOnce([[{ id: 3, invoice_id: 5 }]]);

      const res = await request(app)
        .post('/api/facturas-publicas/1/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5 });

      expect(res.status).toBe(201);
    });
  });
});

// =============================================================================
// SAT CATALOG ROUTES — /api/sat-catalogs
// =============================================================================
describe('SAT Catalog Routes — /api/sat-catalogs', () => {
  const catalogEndpoints = [
    'regimen-fiscal',
    'uso-cfdi',
    'forma-pago',
    'metodo-pago',
    'tipo-comprobante',
    'moneda',
  ];

  catalogEndpoints.forEach(endpoint => {
    test(`GET /api/sat-catalogs/${endpoint} returns data`, async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, clave: '001', descripcion: 'Test' }]]);

      const res = await request(app)
        .get(`/api/sat-catalogs/${endpoint}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  test('GET /api/sat-catalogs/clave-prod-serv returns data', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ clave: '43231500', descripcion: 'Internet' }]]);

    const res = await request(app)
      .get('/api/sat-catalogs/clave-prod-serv')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('GET /api/sat-catalogs/clave-prod-serv with search', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ clave: '43231500', descripcion: 'Servicios de Internet' }]]);

    const res = await request(app)
      .get('/api/sat-catalogs/clave-prod-serv?search=Internet')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/sat-catalogs/clave-unidad returns data', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ clave: 'E48', nombre: 'Unidad de servicio' }]]);

    const res = await request(app)
      .get('/api/sat-catalogs/clave-unidad')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/sat-catalogs/clave-unidad with search', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ clave: 'E48', nombre: 'Unidad de servicio' }]]);

    const res = await request(app)
      .get('/api/sat-catalogs/clave-unidad?search=servicio')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
  });
});

// =============================================================================
// SSE EVENTS ROUTES — /api/events
// =============================================================================
describe('Events Routes — /api/events', () => {
  describe('GET /api/events/stats', () => {
    test('success — returns channel stats', async () => {
      mockAuthUser();

      const res = await request(app)
        .get('/api/events/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('channels');
      expect(res.body).toHaveProperty('totalConnections');
    });
  });

  describe('GET /api/events/tickets/:id — validation', () => {
    test('returns 400 for non-numeric ticket ID', async () => {
      mockAuthUser();

      const res = await request(app)
        .get('/api/events/tickets/abc')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
    });

    test('returns 400 for negative ticket ID', async () => {
      mockAuthUser();

      const res = await request(app)
        .get('/api/events/tickets/-5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
    });
  });
});

// =============================================================================
// FIRERELAY ROUTES — /api/firerelay
// =============================================================================
describe('FireRelay Routes — /api/firerelay', () => {
  describe('GET /api/firerelay/health', () => {
    test('returns node health without auth', async () => {
      db.query
        .mockResolvedValueOnce([[{ cnt: 100 }]])
        .mockResolvedValueOnce([[{ cnt: 50 }]])
        .mockResolvedValueOnce([[{ size_mb: 25 }]]);

      const res = await request(app)
        .get('/api/firerelay/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('node_id');
      expect(res.body).toHaveProperty('status', 'active');
      expect(res.body).toHaveProperty('client_count', 100);
      expect(res.body).toHaveProperty('device_count', 50);
    });

    test('handles DB errors gracefully', async () => {
      db.query.mockRejectedValue(new Error('DB down'));

      const res = await request(app)
        .get('/api/firerelay/health');

      expect(res.status).toBe(200);
      expect(res.body.client_count).toBe(0);
    });
  });
});

// =============================================================================
// PDF ROUTES — /api/pdf
// =============================================================================
describe('PDF Routes — /api/pdf', () => {
  describe('GET /api/pdf/invoices/:id', () => {
    test('success — returns PDF buffer', async () => {
      mockAuthUser();
      pdfService.generateInvoicePdf.mockResolvedValue(Buffer.from('PDF'));

      const res = await request(app)
        .get('/api/pdf/invoices/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/pdf/);
    });

    test('supports locale parameter', async () => {
      mockAuthUser();
      pdfService.generateInvoicePdf.mockResolvedValue(Buffer.from('PDF'));

      await request(app)
        .get('/api/pdf/invoices/1?locale=es')
        .set('Authorization', `Bearer ${authToken}`);

      expect(pdfService.generateInvoicePdf).toHaveBeenCalledWith(1, { locale: 'es' });
    });

    test('handles errors', async () => {
      mockAuthUser();
      pdfService.generateInvoicePdf.mockRejectedValue(new Error('Not found'));

      const res = await request(app)
        .get('/api/pdf/invoices/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/pdf/credit-notes/:id', () => {
    test('success — returns PDF buffer', async () => {
      mockAuthUser();
      pdfService.generateCreditNotePdf.mockResolvedValue(Buffer.from('PDF'));

      const res = await request(app)
        .get('/api/pdf/credit-notes/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/pdf/);
    });
  });

  describe('GET /api/pdf/quotes/:id', () => {
    test('success — returns PDF buffer', async () => {
      mockAuthUser();
      pdfService.generateQuotePdf.mockResolvedValue(Buffer.from('PDF'));

      const res = await request(app)
        .get('/api/pdf/quotes/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/pdf/);
    });
  });

  describe('GET /api/pdf/cfdi/:id', () => {
    test('success — returns PDF buffer', async () => {
      mockAuthUser();
      pdfService.generateCfdiPdf.mockResolvedValue(Buffer.from('PDF'));

      const res = await request(app)
        .get('/api/pdf/cfdi/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/pdf/);
    });
  });

  describe('GET /api/pdf/payments/:id', () => {
    test('success — returns PDF buffer', async () => {
      mockAuthUser();
      pdfService.generatePaymentReceiptPdf.mockResolvedValue(Buffer.from('PDF'));

      const res = await request(app)
        .get('/api/pdf/payments/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/pdf/);
    });

    test('supports locale parameter', async () => {
      mockAuthUser();
      pdfService.generatePaymentReceiptPdf.mockResolvedValue(Buffer.from('PDF'));

      await request(app)
        .get('/api/pdf/payments/1?locale=es')
        .set('Authorization', `Bearer ${authToken}`);

      expect(pdfService.generatePaymentReceiptPdf).toHaveBeenCalledWith(1, { locale: 'es' });
    });

    test('handles errors', async () => {
      mockAuthUser();
      pdfService.generatePaymentReceiptPdf.mockRejectedValue(new Error('Not found'));

      const res = await request(app)
        .get('/api/pdf/payments/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(500);
    });
  });
});

// =============================================================================
// QUOTE ROUTES — /api/quotes
// =============================================================================
describe('Quote Routes — /api/quotes', () => {
  describe('GET /api/quotes', () => {
    test('success — lists quotes', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, total: '500.00' }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/quotes')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/quotes/:id/items', () => {
    test('success — returns line items', async () => {
      mockAuthUser();
      Quote.getItems.mockResolvedValue([{ id: 1, description: 'Setup' }]);

      const res = await request(app)
        .get('/api/quotes/1/items')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/quotes/:id/items', () => {
    test('success — adds a line item', async () => {
      mockAuthUser();
      Quote.addItem.mockResolvedValue({ id: 2, description: 'New Item', amount: '100.00' });

      const res = await request(app)
        .post('/api/quotes/1/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'New Item', quantity: 1, unit_price: 100, amount: 100 });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/quotes/:id/convert-to-invoice', () => {
    test('success — converts quote to invoice', async () => {
      mockAuthUser();
      const conn = mockConnection();
      // billingService is jest.mock()'d whole-module in this file, so
      // nextInvoiceNumber() never actually touches conn — mock it directly.
      billingService.nextInvoiceNumber.mockResolvedValue('INV-000001');
      conn.execute
        .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }]) // insert invoice
        .mockResolvedValueOnce([[{ description: 'Item 1', quantity: 1, unit_price: 100, total: 100, tax_rate_id: 1 }]]) // select quote items
        .mockResolvedValue([{ insertId: 1, affectedRows: 1 }]); // item insert + quote update

      db.query.mockResolvedValue([[{ id: 1, client_id: 5, contract_id: 10, subtotal: '100.00', tax_amount: '16.00', total: '116.00', currency: 'MXN', tax_rate: '0.16', tax_rate_id: 1, notes: 'Test' }]]);
      Invoice.findById.mockResolvedValue({ id: 50, total: '116.00' });

      const res = await request(app)
        .post('/api/quotes/1/convert-to-invoice')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(201);
      expect(conn.commit).toHaveBeenCalled();
    });

    test('rolls back without orphaning the invoice when a later write fails', async () => {
      mockAuthUser();
      const conn = mockConnection();
      // billingService is jest.mock()'d whole-module in this file, so
      // nextInvoiceNumber() never actually touches conn — mock it directly.
      billingService.nextInvoiceNumber.mockResolvedValue('INV-000001');
      conn.execute
        .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }]) // insert invoice
        .mockResolvedValueOnce([[{ description: 'Item 1', quantity: 1, unit_price: 100, total: 100, tax_rate_id: 1 }]]) // select quote items
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // item insert
        .mockRejectedValueOnce(new Error('update failed')); // quote status update fails

      db.query.mockResolvedValue([[{ id: 1, client_id: 5, contract_id: 10, subtotal: '100.00', tax_amount: '16.00', total: '116.00', currency: 'MXN', tax_rate: '0.16', tax_rate_id: 1, notes: 'Test' }]]);

      const res = await request(app)
        .post('/api/quotes/1/convert-to-invoice')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(500);
      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.commit).not.toHaveBeenCalled();
      // The invoice insert ran on the same connection that was rolled back, so
      // nothing is committed — no orphaned invoice can remain.
      expect(Invoice.create).not.toHaveBeenCalled();
    });

    test('returns 404 when quote not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]);

      const res = await request(app)
        .post('/api/quotes/999/convert-to-invoice')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});

// =============================================================================
// PAYMENT ROUTES — /api/payments
// =============================================================================
describe('Payment Routes — /api/payments', () => {
  describe('POST /api/payments', () => {
    test('success — creates payment and records credit', async () => {
      mockAuthUser();
      Payment.create.mockResolvedValue({ id: 1, amount: '500.00', client_id: 10 });
      billingService.recordPaymentCredit.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, amount: 500, payment_method: 'cash', payment_date: '2024-01-01' });

      expect(res.status).toBe(201);
      expect(billingService.recordPaymentCredit).toHaveBeenCalled();
    });

    // Regression: the DB `payments.payment_method` ENUM supports these
    // Mexico-specific instruments (migration 074), but the validation
    // schema previously only allowed 6 of the 14 values — 'spei' and
    // 'oxxo_pay' 422'd before the schema was aligned to the DB ENUM.
    test.each(['spei', 'oxxo_pay'])('success — accepts payment_method=%s (previously 422)', async (payment_method) => {
      mockAuthUser();
      Payment.create.mockResolvedValue({ id: 2, amount: '500.00', client_id: 10, payment_method });
      billingService.recordPaymentCredit.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, amount: 500, payment_method, payment_date: '2024-01-01' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ payment_method });
    });
  });

  describe('POST /api/payments/:id/allocate', () => {
    test('success — allocates payment to invoice', async () => {
      mockAuthUser();
      Payment.allocate.mockResolvedValue({ id: 1, payment_id: 1, invoice_id: 5, amount: '200.00' });
      db.query
        .mockResolvedValueOnce([[{ id: 5, total: '200.00', contract_id: 10 }]])
        .mockResolvedValueOnce([[{ total_allocated: '200.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 10, status: 'suspended' }]]);
      suspensionService.reconnectContract.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/payments/1/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5, amount: 200 });

      expect(res.status).toBe(201);
      expect(suspensionService.reconnectContract).toHaveBeenCalled();
    });

    test('allocates without reconnect when contract is not suspended', async () => {
      mockAuthUser();
      Payment.allocate.mockResolvedValue({ id: 1, payment_id: 1, invoice_id: 5, amount: '200.00' });
      db.query
        .mockResolvedValueOnce([[{ id: 5, total: '200.00', contract_id: 10 }]])
        .mockResolvedValueOnce([[{ total_allocated: '200.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/payments/1/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5, amount: 200 });

      expect(res.status).toBe(201);
      expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
    });

    test('partial allocation does not mark invoice as paid', async () => {
      mockAuthUser();
      Payment.allocate.mockResolvedValue({ id: 1, payment_id: 1, invoice_id: 5, amount: '100.00' });
      db.query
        .mockResolvedValueOnce([[{ id: 5, total: '500.00', contract_id: 10 }]])
        .mockResolvedValueOnce([[{ total_allocated: '100.00' }]]);

      const res = await request(app)
        .post('/api/payments/1/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5, amount: 100 });

      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/payments/:id/allocations', () => {
    test('success — returns allocations', async () => {
      mockAuthUser();
      Payment.getAllocations.mockResolvedValue([{ id: 1, amount: '200.00' }]);

      const res = await request(app)
        .get('/api/payments/1/allocations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/payments/:id/send-receipt', () => {
    test('success — sends receipt email', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[{
        id: 1, client_id: 1, amount: 500, currency: 'MXN',
        payment_date: '2026-04-15', payment_method: 'bank_transfer',
        reference_number: 'TXN-123', first_name: 'Juan', last_name: 'García',
        client_email: 'juan@example.com', org_name: 'Test ISP',
      }]]);
      pdfService.generatePaymentReceiptPdf.mockResolvedValue(Buffer.from('PDF'));
      const emailTransport = require('../src/services/emailTransport');
      emailTransport.sendEmail.mockResolvedValue({ success: true });
      const templates = require('../src/views/emailTemplates');
      templates.paymentReceiptEmail.mockReturnValue({ subject: 'Payment Confirmed', html: '<p>receipt</p>' });

      const res = await request(app)
        .post('/api/payments/1/send-receipt')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Receipt sent');
      expect(res.body.to).toBe('juan@example.com');
    });

    test('404 — payment not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/payments/999/send-receipt')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    test('422 — client has no email', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[{
        id: 1, client_id: 1, amount: 500, currency: 'MXN',
        payment_date: '2026-04-15', payment_method: 'cash',
        first_name: 'Juan', last_name: 'García',
        client_email: null, org_name: 'Test ISP',
      }]]);

      const res = await request(app)
        .post('/api/payments/1/send-receipt')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(422);
    });
  });
});

// =============================================================================
// INVOICE ROUTES — /api/invoices (additional coverage)
// =============================================================================
describe('Invoice Routes — /api/invoices (extended)', () => {
  describe('GET /api/invoices/:id/items', () => {
    test('success — returns invoice items', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, description: 'Internet Service' }]]);

      const res = await request(app)
        .get('/api/invoices/1/items')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/invoices/:id/items', () => {
    test('success — adds an invoice item', async () => {
      mockAuthUser();
      Invoice.addItem.mockResolvedValue({ id: 2, description: 'Setup Fee' });

      const res = await request(app)
        .post('/api/invoices/1/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Setup Fee', quantity: 1, unit_price: 50, amount: 50 });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/invoices/generate', () => {
    test('success — generates invoice from contract', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 1, plan_id: 5 }]])
        .mockResolvedValueOnce([[{ id: 5, name: 'Basic', price: '299.00' }]]);
      billingService.generateBillingPeriod.mockResolvedValue({ id: 10, contract_id: 1 });
      billingService.generateInvoice.mockResolvedValue({ id: 20, total: '299.00' });

      const res = await request(app)
        .post('/api/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(201);
    });

    test('returns 404 when contract not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]);

      const res = await request(app)
        .post('/api/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 999 });

      expect(res.status).toBe(404);
    });

    test('returns 404 when plan not found', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 1, plan_id: 5 }]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(404);
    });

    test('new format — stamps contract_id on the invoice for a single-contract charge', async () => {
      mockAuthUser();
      db.query.mockImplementation((sql) => {
        if (/FROM clients/.test(sql)) return Promise.resolve([[{ id: 5 }]]);
        if (/FROM contracts/.test(sql)) return Promise.resolve([[{ id: 7, plan_id: 5, price_override: null }]]);
        if (/FROM plans/.test(sql)) return Promise.resolve([[{ id: 5, name: 'Basic', price: '299.00', currency: 'MXN' }]]);
        return Promise.resolve([[]]); // tax_rates (no default) etc.
      });
      billingService.generateBillingPeriod.mockResolvedValue({ id: 10, period_start: '2026-01-01', period_end: '2026-01-31' });
      // billingService is jest.mock()'d whole-module in this file, so
      // nextInvoiceNumber() never actually touches conn — mock it directly.
      billingService.nextInvoiceNumber.mockResolvedValue('INV-000020');
      Invoice.findById.mockResolvedValue({ id: 20, contract_id: 7 });
      const conn = mockConnection();
      conn.execute.mockImplementation((sql) => {
        if (/INSERT INTO invoices/.test(sql)) return Promise.resolve([{ insertId: 20, affectedRows: 1 }]);
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      });

      const res = await request(app)
        .post('/api/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 5, items: [{ type: 'contract', contract_id: 7 }] });

      expect(res.status).toBe(201);
      const invInsert = conn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
      expect(invInsert).toBeDefined();
      // columns: (organization_id, client_id, contract_id, …) → contract_id is param index 2
      expect(invInsert[1][2]).toBe(7);
    });

    test('new format — computes tax correctly from a fraction tax_rates.rate', async () => {
      mockAuthUser();
      db.query.mockImplementation((sql) => {
        if (/FROM clients/.test(sql)) return Promise.resolve([[{ id: 5 }]]);
        if (/FROM contracts/.test(sql)) return Promise.resolve([[{ id: 7, plan_id: 5, price_override: null }]]);
        if (/FROM plans/.test(sql)) return Promise.resolve([[{ id: 5, name: 'Basic', price: '500.00', currency: 'MXN' }]]);
        // tax_rates.rate is a FRACTION (DECIMAL(5,4); 0.1600 = 16%) per
        // schema/migration 121 — not a whole percent.
        if (/FROM tax_rates/.test(sql)) return Promise.resolve([[{ id: 1, rate: '0.1600', is_default: true }]]);
        return Promise.resolve([[]]);
      });
      billingService.generateBillingPeriod.mockResolvedValue({ id: 10, period_start: '2026-01-01', period_end: '2026-01-31' });
      // billingService is jest.mock()'d whole-module in this file, so
      // nextInvoiceNumber() never actually touches conn — mock it directly.
      billingService.nextInvoiceNumber.mockResolvedValue('INV-000021');
      Invoice.findById.mockResolvedValue({ id: 21, contract_id: 7 });
      const conn = mockConnection();
      conn.execute.mockImplementation((sql) => {
        if (/INSERT INTO invoices/.test(sql)) return Promise.resolve([{ insertId: 21, affectedRows: 1 }]);
        return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      });

      const res = await request(app)
        .post('/api/invoices/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 5, items: [{ type: 'contract', contract_id: 7 }] });

      expect(res.status).toBe(201);
      const invInsert = conn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
      expect(invInsert).toBeDefined();
      // columns: (organization_id, client_id, contract_id, invoice_number,
      // subtotal, tax_amount, total, …). 500 subtotal @ 16% -> 80.00 tax,
      // 580.00 total — this fails if the formula regresses to `* taxPct) / 100`.
      expect(invInsert[1][4]).toBe(500);   // subtotal
      expect(invInsert[1][5]).toBe(80);    // tax_amount
      expect(invInsert[1][6]).toBe(580);   // total
    });
  });

  describe('GET /api/invoices/:id/payments', () => {
    test('success — returns payment allocations', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, amount: '500.00', payment_method: 'cash' }]]);

      const res = await request(app)
        .get('/api/invoices/1/payments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});

// =============================================================================
// TWO-FACTOR AUTH ROUTES — /api/2fa
// =============================================================================
describe('Two-Factor Auth Routes — /api/2fa', () => {
  describe('GET /api/2fa/status', () => {
    test('success — returns 2FA status', async () => {
      mockAuthUser();
      twoFactorService.getStatus.mockResolvedValue({ enabled: false });

      const res = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
    });
  });

  describe('POST /api/2fa/setup', () => {
    test('success — generates TOTP secret', async () => {
      mockAuthUser();
      twoFactorService.generateSecret.mockResolvedValue({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauth_url: 'otpauth://totp/FireISP:test@example.com?secret=JBSWY3DPEHPK3PXP',
      });

      const res = await request(app)
        .post('/api/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('secret');
    });
  });

  describe('POST /api/2fa/verify', () => {
    test('success — verifies and enables 2FA', async () => {
      mockAuthUser();
      twoFactorService.verifyAndEnable.mockResolvedValue({ enabled: true, backup_codes: ['code1'] });

      const res = await request(app)
        .post('/api/2fa/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(true);
    });
  });

  describe('POST /api/2fa/validate', () => {
    test('success — validates a 2FA code', async () => {
      mockAuthUser();
      twoFactorService.verifyCode.mockResolvedValue({ valid: true });

      const res = await request(app)
        .post('/api/2fa/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });
  });

  describe('POST /api/2fa/disable', () => {
    test('success — disables 2FA', async () => {
      mockAuthUser();
      twoFactorService.verifyCode.mockResolvedValue({ valid: true });
      twoFactorService.disable.mockResolvedValue({ enabled: false });

      const res = await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
    });
  });

  describe('POST /api/2fa/backup-codes', () => {
    test('success — regenerates backup codes', async () => {
      mockAuthUser();
      twoFactorService.regenerateBackupCodes.mockResolvedValue({ codes: ['a1', 'b2', 'c3'] });

      const res = await request(app)
        .post('/api/2fa/backup-codes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.codes).toHaveLength(3);
    });
  });
});

// =============================================================================
// CLIENT SUB-ROUTES — /api/clients (contacts, mx-profile, contracts, invoices, balance)
// =============================================================================
describe('Client Sub-Routes — /api/clients', () => {
  describe('GET /api/clients/:id/contacts', () => {
    test('success — returns client contacts', async () => {
      mockAuthUser();
      Client.getContacts.mockResolvedValue([{ id: 1, name: 'John Doe' }]);

      const res = await request(app)
        .get('/api/clients/1/contacts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/clients/:id/contacts', () => {
    test('success — creates a contact', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 5 }])
        .mockResolvedValueOnce([[{ id: 5, name: 'Jane Doe', email: 'jane@test.com' }]]);

      const res = await request(app)
        .post('/api/clients/1/contacts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Jane Doe', email: 'jane@test.com', phone: '555-0100', role: 'billing' });

      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/clients/:id/mx-profile', () => {
    test('success — returns MX profile', async () => {
      mockAuthUser();
      Client.getMxProfile.mockResolvedValue({ rfc: 'XAXX010101000', curp: null });

      const res = await request(app)
        .get('/api/clients/1/mx-profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.rfc).toBe('XAXX010101000');
    });
  });

  describe('PUT /api/clients/:id/mx-profile', () => {
    test('success — updates existing MX profile', async () => {
      mockAuthUser();
      Client.getMxProfile
        .mockResolvedValueOnce({ rfc: 'XAXX010101000' })
        .mockResolvedValueOnce({ rfc: 'XAXX010101001' });
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/clients/1/mx-profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ rfc: 'XAXX010101001', razon_social: 'Test Company SA', regimen_fiscal: '601', codigo_postal_fiscal: '06700' });

      expect(res.status).toBe(200);
    });

    test('success — creates MX profile when none exists', async () => {
      mockAuthUser();
      Client.getMxProfile
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ rfc: 'XAXX010101000' });
      db.query.mockResolvedValue([{ insertId: 1 }]);

      const res = await request(app)
        .put('/api/clients/1/mx-profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ rfc: 'XAXX010101000', razon_social: 'Empresa SA', regimen_fiscal: '601', codigo_postal_fiscal: '06700' });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/clients/:id/contracts', () => {
    test('success — returns client contracts', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, status: 'active' }]]);

      const res = await request(app)
        .get('/api/clients/1/contracts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/clients/:id/invoices', () => {
    test('success — returns client invoices', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, total: '500.00' }]]);

      const res = await request(app)
        .get('/api/clients/1/invoices')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/clients/:id/balance-ledger', () => {
    test('success — returns balance ledger entries', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 1, type: 'credit', amount: '500.00' }]]);

      const res = await request(app)
        .get('/api/clients/1/balance-ledger')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
