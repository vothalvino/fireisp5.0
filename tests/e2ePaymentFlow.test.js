// =============================================================================
// FireISP 5.0 — E2E Payment Flow Test
// =============================================================================
// Full lifecycle: create client → create plan → assign plan (contract) →
//   generate invoice → record payment → allocate payment → verify ledger.
// =============================================================================

// Mock the database module before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'admin@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

function mockConnection() {
  const conn = {
    execute: jest.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]),
    // Contract creation provisioning runs writes/reads on the transaction
    // connection via `.query`. Resolve sensible defaults per statement type.
    query: jest.fn().mockImplementation((sql) => {
      if (/INSERT INTO contracts/i.test(sql)) return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
      if (/INSERT INTO radius/i.test(sql)) return Promise.resolve([{ insertId: 50, affectedRows: 1 }]);
      if (/FROM plans/i.test(sql)) return Promise.resolve([[{ id: 1 }]]); // plan is live (assertPlanSelectable)
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    }),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// E2E Payment Flow
// =============================================================================
describe('E2E Payment Flow: client → plan → contract → invoice → payment → ledger', () => {

  // =========================================================================
  // Step 1: Create a client
  // =========================================================================
  describe('Step 1: Create Client — POST /api/v1/clients', () => {
    const clientPayload = {
      name: 'María García',
      email: 'maria@example.com',
      phone: '+52 55 1234 5678',
      client_type: 'residential',
      address: 'Av. Insurgentes Sur 1000',
      city: 'Ciudad de México',
      state: 'CDMX',
      zip_code: '03100',
      country: 'MX',
    };

    const mockClient = {
      id: 10,
      organization_id: 1,
      ...clientPayload,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    };

    test('creates a new client successfully', async () => {
      mockAuthUser();
      // BaseModel.create: INSERT → findByIdIncludingDeleted → auditLog
      db.query
        // quotaCheck: SELECT * FROM organization_quotas → no row → unlimited
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }])
        .mockResolvedValueOnce([[mockClient]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send(clientPayload);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ id: 10, name: 'María García' });
    });

    test('rejects client without required name', async () => {
      mockAuthUser();
      // quotaCheck: SELECT * FROM organization_quotas → no row → unlimited
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'missing-name@example.com' });

      expect(res.status).toBe(422);
    });
  });

  // =========================================================================
  // Step 2: Create a plan
  // =========================================================================
  describe('Step 2: Create Plan — POST /api/v1/plans', () => {
    const planPayload = {
      name: 'Fibra 100 Mbps',
      description: 'Internet de fibra óptica 100/50 Mbps',
      download_speed_mbps: 100,
      upload_speed_mbps: 50,
      price: 599.00,
      billing_cycle: 'monthly',
      currency: 'MXN',
    };

    const mockPlan = {
      id: 5,
      organization_id: 1,
      ...planPayload,
      status: 'active',
    };

    test('creates a new plan successfully', async () => {
      mockAuthUser();
      // BaseModel.create: INSERT → findByIdIncludingDeleted → auditLog
      db.query
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])
        .mockResolvedValueOnce([[mockPlan]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(planPayload);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ id: 5, name: 'Fibra 100 Mbps', price: 599 });
    });
  });

  // =========================================================================
  // Step 3: Assign plan to client (create contract)
  // =========================================================================
  describe('Step 3: Create Contract — POST /api/v1/contracts', () => {
    const contractPayload = {
      client_id: 10,
      plan_id: 5,
      connection_type: 'pppoe',
      start_date: '2026-02-01',
      billing_day: 1,
      status: 'active',
    };

    const mockContract = {
      id: 1,
      organization_id: 1,
      ...contractPayload,
      price_override: null,
      ip_address: null,
    };

    test('creates a contract linking client to plan', async () => {
      mockAuthUser();
      // Contract create runs in a transaction: INSERT contract → SELECT client
      // name (username seed) → PPPoE provisioning (radius username check, IPv4
      // pool lookup, radius INSERT) → commit → Contract.findById → auditLog.
      const conn = {
        query: jest.fn()
          .mockResolvedValueOnce([[{ id: 1 }]])                      // assertPlanSelectable — plan is live
          .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT contracts
          .mockResolvedValueOnce([[{ name: 'Acme' }]])               // SELECT client name
          .mockResolvedValueOnce([[]])                               // radius username uniqueness
          .mockResolvedValueOnce([[]])                               // IPv4 pool lookup (none)
          .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }]), // INSERT radius
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);
      db.query
        .mockResolvedValueOnce([[mockContract]])     // Contract.findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(contractPayload);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        id: 1,
        client_id: 10,
        plan_id: 5,
        status: 'active',
      });
      expect(res.body.data.provisioning.pppoe.username).toBeTruthy();
      expect(res.body.data.provisioning.pppoe.password).toBeTruthy();
    });

    test('rejects contract without required client_id', async () => {
      mockAuthUser();

      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ plan_id: 5, start_date: '2026-02-01' });

      expect(res.status).toBe(422);
    });
  });

  // =========================================================================
  // Step 4: Generate invoice from contract
  // =========================================================================
  describe('Step 4: Generate Invoice — POST /api/v1/billing/generate-invoice', () => {
    const mockContract = {
      id: 1, organization_id: 1, client_id: 10, plan_id: 5,
      start_date: '2026-02-01', billing_day: 1,
      price_override: null, tax_rate_id: null, status: 'active',
    };
    const mockPlan = {
      id: 5, name: 'Fibra 100 Mbps', price: '599.00',
      currency: 'MXN', status: 'active',
    };
    const mockInvoice = {
      id: 200, organization_id: 1, client_id: 10, contract_id: 1,
      invoice_number: 'INV-000001',
      subtotal: '599.00', tax_amount: '95.84', total: '694.84',
      currency: 'MXN', status: 'issued',
      due_date: '2026-03-17',
    };

    test('generates invoice with correct tax calculation', async () => {
      mockAuthUser();
      const conn = mockConnection();

      // billingController.generateInvoice:
      //   1) db.query → SELECT contract
      //   2) db.query → SELECT plan
      // billingService.generateBillingPeriod:
      //   3) db.query → existing pending period (none)
      //   4) db.query → last invoiced period (none)
      //   5) db.query → INSERT billing period
      //   6) db.query → SELECT new period by id
      db.query
        .mockResolvedValueOnce([[mockContract]])
        .mockResolvedValueOnce([[mockPlan]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 100 }])
        .mockResolvedValueOnce([[{
          id: 100, contract_id: 1, status: 'pending',
          period_start: '2026-02-01', period_end: '2026-03-02',
        }]]);

      // billingService.generateInvoice (uses conn.execute inside transaction):
      conn.execute
        .mockResolvedValueOnce([[{ id: 100, status: 'pending' }]])             // FOR UPDATE lock
        .mockResolvedValueOnce([[{ id: 1, rate: '16.00', is_default: true }]]) // tax rate
        .mockResolvedValueOnce([[{ cnt: 0 }]])                                 // invoice count
        .mockResolvedValueOnce([{ insertId: 200 }])                            // INSERT invoice
        .mockResolvedValueOnce([{ affectedRows: 1 }])                          // INSERT line item
        .mockResolvedValueOnce([[]])                                            // contract addons
        .mockResolvedValueOnce([{ affectedRows: 1 }])                          // UPDATE billing_period
        .mockResolvedValueOnce([{ insertId: 1 }]);                             // INSERT ledger debit

      // Invoice.findById (at end of billingService.generateInvoice)
      db.query.mockResolvedValueOnce([[mockInvoice]]);

      const res = await request(app)
        .post('/api/v1/billing/generate-invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        id: 200,
        invoice_number: 'INV-000001',
        total: '694.84',
        status: 'issued',
      });
      expect(conn.beginTransaction).toHaveBeenCalled();
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    test('returns 404 when contract does not exist', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/v1/billing/generate-invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 9999 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // Step 5: Record payment
  // =========================================================================
  describe('Step 5: Record Payment — POST /api/v1/payments', () => {
    const paymentPayload = {
      client_id: 10,
      amount: 694.84,
      currency: 'MXN',
      payment_method: 'bank_transfer',
      reference_number: 'SPEI-20260301-001',
      status: 'completed',
    };

    const mockPayment = {
      id: 300,
      organization_id: 1,
      ...paymentPayload,
    };

    test('creates payment and records ledger credit', async () => {
      mockAuthUser();
      // Payment.create: INSERT → findByIdIncludingDeleted
      // Then route calls billingService.recordPaymentCredit → INSERT ledger
      db.query
        .mockResolvedValueOnce([{ insertId: 300, affectedRows: 1 }])
        .mockResolvedValueOnce([[mockPayment]])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentPayload);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        id: 300,
        client_id: 10,
        amount: 694.84,
      });
      // Verify ledger insert was called
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('client_balance_ledger'),
        expect.arrayContaining([10, 1]),
      );
    });
  });

  // =========================================================================
  // Step 6: Allocate payment to invoice
  // =========================================================================
  describe('Step 6: Allocate Payment — POST /api/v1/payments/:id/allocate', () => {
    test('allocates payment to invoice and marks invoice paid', async () => {
      mockAuthUser();

      const mockAllocation = { id: 1, payment_id: 300, invoice_id: 200, amount: '694.84' };

      // Route: SELECT invoice (void guard) → Payment.allocate (INSERT → SELECT) →
      //        SUM allocations → UPDATE invoice → SELECT contract
      db.query
        .mockResolvedValueOnce([[{ id: 200, total: '694.84', contract_id: 1, status: 'issued' }]])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[mockAllocation]])
        .mockResolvedValueOnce([[{ total_allocated: '694.84' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/v1/payments/300/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 200, amount: 694.84 });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        id: 1,
        payment_id: 300,
        invoice_id: 200,
        amount: '694.84',
      });

      // Verify invoice was marked as paid
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.arrayContaining(['paid', 200]),
      );
    });

    test('allocates partial payment without marking invoice paid', async () => {
      mockAuthUser();

      const mockAllocation = { id: 2, payment_id: 301, invoice_id: 200, amount: '300.00' };

      // Route: SELECT invoice (void guard) → Payment.allocate (INSERT → SELECT) →
      //        SUM allocations (partial — no UPDATE since not fully paid)
      db.query
        .mockResolvedValueOnce([[{ id: 200, total: '694.84', contract_id: 1, status: 'issued' }]])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([[mockAllocation]])
        .mockResolvedValueOnce([[{ total_allocated: '300.00' }]]);

      const res = await request(app)
        .post('/api/v1/payments/301/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 200, amount: 300.00 });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ id: 2, amount: '300.00' });
      // Invoice should NOT have been marked paid (only 4 db.query calls)
      expect(db.query).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // Step 7: Verify ledger entries
  // =========================================================================
  describe('Step 7: Verify Ledger — GET /api/v1/clients/:id/balance-ledger', () => {
    test('returns ledger with debit (invoice) and credit (payment) entries', async () => {
      mockAuthUser();

      const mockLedger = [
        {
          id: 2, client_id: 10, organization_id: 1,
          entry_type: 'credit', amount: '694.84', currency: 'MXN',
          reference_type: 'payment', reference_id: 300,
          description: 'Payment SPEI-20260301-001',
          created_at: '2026-03-01T12:00:00.000Z',
        },
        {
          id: 1, client_id: 10, organization_id: 1,
          entry_type: 'debit', amount: '694.84', currency: 'MXN',
          reference_type: 'invoice', reference_id: 200,
          description: 'Invoice INV-000001',
          created_at: '2026-03-01T10:00:00.000Z',
        },
      ];

      db.query.mockResolvedValueOnce([mockLedger]);

      const res = await request(app)
        .get('/api/v1/clients/10/balance-ledger')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      // Most recent first (credit = payment)
      expect(res.body.data[0]).toMatchObject({
        entry_type: 'credit',
        reference_type: 'payment',
        amount: '694.84',
      });
      // Older entry (debit = invoice)
      expect(res.body.data[1]).toMatchObject({
        entry_type: 'debit',
        reference_type: 'invoice',
        amount: '694.84',
      });
    });

    test('returns empty ledger for client with no activity', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/v1/clients/999/balance-ledger')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // =========================================================================
  // Full Pipeline: All steps in sequence
  // =========================================================================
  describe('Full Pipeline: client → plan → contract → invoice → payment → allocate → ledger', () => {
    test('completes full payment lifecycle end-to-end', async () => {
      const conn = mockConnection();
      mockAuthUser();

      // --- Step 1: Create client ---
      // BaseModel.create: INSERT → findByIdIncludingDeleted → auditLog
      db.query
        // quotaCheck: SELECT * FROM organization_quotas → no row → unlimited
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }])
        .mockResolvedValueOnce([[{
          id: 10, organization_id: 1, name: 'María García',
          email: 'maria@example.com', status: 'active',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const clientRes = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'María García', email: 'maria@example.com' });

      expect(clientRes.status).toBe(201);
      const clientId = clientRes.body.data.id;
      expect(clientId).toBe(10);

      // --- Step 2: Create plan ---
      // BaseModel.create: INSERT → findByIdIncludingDeleted → auditLog
      db.query
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])
        .mockResolvedValueOnce([[{
          id: 5, organization_id: 1, name: 'Fibra 100',
          download_speed_mbps: 100, upload_speed_mbps: 50,
          price: 599, currency: 'MXN', status: 'active',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const planRes = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Fibra 100', download_speed_mbps: 100, upload_speed_mbps: 50,
          price: 599, billing_cycle: 'monthly', currency: 'MXN',
        });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.data.id;
      expect(planId).toBe(5);

      // --- Step 3: Create contract ---
      // INSERT runs on the transaction connection; db.query serves
      // Contract.findById then auditLog.
      db.query
        .mockResolvedValueOnce([[{
          id: 1, organization_id: 1, client_id: clientId, plan_id: planId,
          start_date: '2026-02-01', billing_day: 1, status: 'active',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const contractRes = await request(app)
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: clientId, plan_id: planId,
          connection_type: 'pppoe', start_date: '2026-02-01',
          billing_day: 1, status: 'active',
        });

      expect(contractRes.status).toBe(201);
      const contractId = contractRes.body.data.id;
      expect(contractId).toBe(1);

      // --- Step 4: Generate invoice ---
      // billingController: SELECT contract, SELECT plan
      // billingService.generateBillingPeriod: 4 db.query calls
      db.query
        .mockResolvedValueOnce([[{
          id: contractId, organization_id: 1, client_id: clientId,
          plan_id: planId, start_date: '2026-02-01', billing_day: 1,
          price_override: null, tax_rate_id: null, status: 'active',
        }]])
        .mockResolvedValueOnce([[{
          id: planId, name: 'Fibra 100', price: '599.00', currency: 'MXN',
        }]])
        .mockResolvedValueOnce([[]])                         // no pending period
        .mockResolvedValueOnce([[]])                         // no last invoiced
        .mockResolvedValueOnce([{ insertId: 100 }])          // INSERT period
        .mockResolvedValueOnce([[{
          id: 100, contract_id: contractId, status: 'pending',
          period_start: '2026-02-01', period_end: '2026-03-02',
        }]]);

      // billingService.generateInvoice: 8 conn.execute calls
      conn.execute
        .mockResolvedValueOnce([[{ id: 100, status: 'pending' }]])
        .mockResolvedValueOnce([[{ id: 1, rate: '16.00', is_default: true }]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 200 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      // Invoice.findById at end of generateInvoice
      db.query.mockResolvedValueOnce([[{
        id: 200, organization_id: 1, client_id: clientId,
        invoice_number: 'INV-000001',
        subtotal: '599.00', tax_amount: '95.84', total: '694.84',
        currency: 'MXN', status: 'issued',
      }]]);

      const invoiceRes = await request(app)
        .post('/api/v1/billing/generate-invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: contractId });

      expect(invoiceRes.status).toBe(201);
      const invoiceId = invoiceRes.body.data.id;
      expect(invoiceId).toBe(200);
      expect(invoiceRes.body.data.total).toBe('694.84');

      // --- Step 5: Record payment ---
      // Payment.create: INSERT → findByIdIncludingDeleted
      // billingService.recordPaymentCredit: INSERT ledger
      db.query
        .mockResolvedValueOnce([{ insertId: 300, affectedRows: 1 }])
        .mockResolvedValueOnce([[{
          id: 300, organization_id: 1, client_id: clientId,
          amount: 694.84, currency: 'MXN',
          payment_method: 'bank_transfer', reference_number: 'SPEI-001',
          status: 'completed',
        }]])
        .mockResolvedValueOnce([{ insertId: 1 }]);

      const paymentRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: clientId, amount: 694.84, currency: 'MXN',
          payment_method: 'bank_transfer', reference_number: 'SPEI-001',
          status: 'completed',
        });

      expect(paymentRes.status).toBe(201);
      const paymentId = paymentRes.body.data.id;
      expect(paymentId).toBe(300);

      // --- Step 6: Allocate payment to invoice ---
      // Route: SELECT invoice (void guard) → Payment.allocate (INSERT → SELECT) →
      //        SUM allocations → UPDATE invoice → SELECT contract
      db.query
        .mockResolvedValueOnce([[{ id: invoiceId, total: '694.84', contract_id: contractId, status: 'issued' }]])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, payment_id: paymentId, invoice_id: invoiceId, amount: '694.84' }]])
        .mockResolvedValueOnce([[{ total_allocated: '694.84' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[]]);

      const allocateRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/allocate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: invoiceId, amount: 694.84 });

      expect(allocateRes.status).toBe(201);
      expect(allocateRes.body.data).toMatchObject({
        id: 1,
        payment_id: paymentId,
        invoice_id: invoiceId,
        amount: '694.84',
      });

      // --- Step 7: Verify ledger ---
      const ledgerEntries = [
        {
          id: 2, client_id: clientId, organization_id: 1,
          entry_type: 'credit', amount: '694.84', currency: 'MXN',
          reference_type: 'payment', reference_id: paymentId,
          description: 'Payment SPEI-001',
        },
        {
          id: 1, client_id: clientId, organization_id: 1,
          entry_type: 'debit', amount: '694.84', currency: 'MXN',
          reference_type: 'invoice', reference_id: invoiceId,
          description: 'Invoice INV-000001',
        },
      ];

      db.query.mockResolvedValueOnce([ledgerEntries]);

      const ledgerRes = await request(app)
        .get(`/api/v1/clients/${clientId}/balance-ledger`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(ledgerRes.status).toBe(200);
      expect(ledgerRes.body.data).toHaveLength(2);

      // Verify debit and credit entries balance out
      const debitTotal = ledgerRes.body.data
        .filter(e => e.entry_type === 'debit')
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);
      const creditTotal = ledgerRes.body.data
        .filter(e => e.entry_type === 'credit')
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

      expect(debitTotal).toBeCloseTo(creditTotal, 2);

      // Verify invoice reference in debit
      const debitEntry = ledgerRes.body.data.find(e => e.entry_type === 'debit');
      expect(debitEntry.reference_type).toBe('invoice');
      expect(debitEntry.reference_id).toBe(invoiceId);

      // Verify payment reference in credit
      const creditEntry = ledgerRes.body.data.find(e => e.entry_type === 'credit');
      expect(creditEntry.reference_type).toBe('payment');
      expect(creditEntry.reference_id).toBe(paymentId);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    test('rejects payment allocation with missing invoice_id', async () => {
      mockAuthUser();

      const res = await request(app)
        .post('/api/v1/payments/300/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: 100 });

      expect(res.status).toBe(422);
    });

    test('invoice generation returns 404 for missing plan', async () => {
      mockAuthUser();

      db.query
        .mockResolvedValueOnce([[{
          id: 1, organization_id: 1, client_id: 10, plan_id: 999,
          status: 'active',
        }]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post('/api/v1/billing/generate-invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('requires authentication for all payment flow endpoints', async () => {
      const endpoints = [
        { method: 'post', url: '/api/v1/clients' },
        { method: 'post', url: '/api/v1/plans' },
        { method: 'post', url: '/api/v1/contracts' },
        { method: 'post', url: '/api/v1/billing/generate-invoice' },
        { method: 'post', url: '/api/v1/payments' },
        { method: 'post', url: '/api/v1/payments/1/allocate' },
        { method: 'get', url: '/api/v1/clients/1/balance-ledger' },
      ];

      for (const ep of endpoints) {
        const res = await request(app)[ep.method](ep.url).send({});
        expect(res.status).toBe(401);
      }
    });
  });
});
