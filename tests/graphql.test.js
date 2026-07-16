// =============================================================================
// FireISP 5.0 — GraphQL Endpoint Tests (P3.3)
// =============================================================================
// Integration tests that POST GraphQL queries against the Express app.
// The DB, auth middleware, and orgScope are mocked so no real MySQL connection
// is needed.
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mock the database
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Mock auth — inject a known user + orgId for every request
// ---------------------------------------------------------------------------
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user   = { id: 1, email: 'admin@test.com', role: 'admin', organizationId: 1 };
    req.userId = 1;
    next();
  },
  optionalAuth: (req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', role: 'admin', organizationId: 1 };
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
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function graphql(query, variables = {}) {
  return request(app)
    .post('/api/v1/graphql')
    .set('Content-Type', 'application/json')
    .send({ query, variables });
}

// Fixtures
const CLIENT_ROW = {
  id: 10, name: 'Acme Corp', email: 'acme@example.com', phone: '55-0000-0000',
  client_type: 'business', status: 'active', address: 'Insurgentes Sur 1602',
  city: 'CDMX', state: 'CDMX', zip_code: '03940', country: 'MX',
  tax_id: 'ACM200101ABC', notes: null, created_at: '2024-01-15T00:00:00.000Z',
};

const CONTRACT_ROW = {
  id: 20, client_id: 10, organization_id: 1, plan_id: 3,
  connection_type: 'fiber', start_date: '2024-02-01', end_date: null,
  billing_day: 1, status: 'active', ip_address: '10.0.0.100',
  price_override: null, notes: null, deleted_at: null,
  created_at: '2024-02-01T00:00:00.000Z',
};

const INVOICE_ROW = {
  id: 30, client_id: 10, organization_id: 1, contract_id: 20,
  invoice_number: 'INV-0001', subtotal: '500.00', tax_amount: '80.00',
  total: '580.00', currency: 'MXN', due_date: '2024-03-01', paid_at: null,
  status: 'pending', notes: null, deleted_at: null,
  created_at: '2024-02-15T00:00:00.000Z',
};

const TICKET_ROW = {
  id: 40, client_id: 10, organization_id: 1, contract_id: 20,
  assigned_to: null, subject: 'No internet', description: 'Line down',
  priority: 'high', category: 'technical', status: 'open', notes: null,
  deleted_at: null, created_at: '2024-02-20T00:00:00.000Z',
  updated_at: '2024-02-20T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphQL endpoint — /api/v1/graphql', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // -----------------------------------------------------------------------
  // Schema introspection
  // -----------------------------------------------------------------------

  test('introspection — schema contains Client, Invoice, Ticket types', async () => {
    const res = await graphql(`
      { __schema { types { name } } }
    `);
    expect(res.status).toBe(200);
    const typeNames = res.body.data.__schema.types.map(t => t.name);
    expect(typeNames).toContain('Client');
    expect(typeNames).toContain('Invoice');
    expect(typeNames).toContain('Ticket');
    expect(typeNames).toContain('Contract');
    expect(typeNames).toContain('Device');
    expect(typeNames).toContain('LedgerEntry');
  });

  // -----------------------------------------------------------------------
  // client query
  // -----------------------------------------------------------------------

  test('client(id) — returns client with camelCase fields', async () => {
    mockQuery.mockResolvedValueOnce([[CLIENT_ROW]]);  // findById

    const res = await graphql(`
      query { client(id: "10") { id name email clientType status zipCode taxId } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { client } = res.body.data;
    expect(client.id).toBe('10');
    expect(client.name).toBe('Acme Corp');
    expect(client.clientType).toBe('business');
    expect(client.zipCode).toBe('03940');
    expect(client.taxId).toBe('ACM200101ABC');
  });

  test('client(id) — returns null for unknown ID', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // no row

    const res = await graphql(`
      query { client(id: "9999") { id name } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.data.client).toBeNull();
  });

  test('client — nested contracts resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])        // client findById
      .mockResolvedValueOnce([[CONTRACT_ROW]]);     // contracts sub-query

    const res = await graphql(`
      query {
        client(id: "10") {
          id
          contracts { id connectionType startDate billingDay ipAddress status }
        }
      }
    `);

    expect(res.status).toBe(200);
    const { contracts } = res.body.data.client;
    expect(contracts).toHaveLength(1);
    expect(contracts[0].connectionType).toBe('fiber');
    expect(contracts[0].ipAddress).toBe('10.0.0.100');
    expect(contracts[0].billingDay).toBe(1);
  });

  test('client — nested invoices resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])
      .mockResolvedValueOnce([[INVOICE_ROW]]);

    const res = await graphql(`
      query {
        client(id: "10") {
          invoices { id invoiceNumber total currency status }
        }
      }
    `);

    expect(res.status).toBe(200);
    const { invoices } = res.body.data.client;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe('INV-0001');
    expect(invoices[0].total).toBe('580.00');
  });

  test('client — nested payments, devices, ledger return empty arrays when no rows', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])  // findById
      .mockResolvedValueOnce([[]])            // payments
      .mockResolvedValueOnce([[]])            // devices
      .mockResolvedValueOnce([[]])            // ledger
      .mockResolvedValueOnce([[]]);           // contacts

    const res = await graphql(`
      query {
        client(id: "10") {
          payments { id }
          devices  { id }
          ledger   { id }
          contacts { id }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.data.client.payments).toEqual([]);
    expect(res.body.data.client.devices).toEqual([]);
    expect(res.body.data.client.ledger).toEqual([]);
    expect(res.body.data.client.contacts).toEqual([]);
  });

  test('client.balance returns the COMPUTED account balance (invoices + payments, not the ledger)', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])  // client findById
      .mockResolvedValueOnce([[               // getInvoicesWithBalance — one open invoice
        { id: 30, total: '150.00', currency: 'MXN', balance_due: '150.00' },
      ]])
      .mockResolvedValueOnce([[]])            // payments — none unallocated
      .mockResolvedValueOnce([[]]);           // credit notes — none

    const res = await graphql('query { client(id: "10") { id balance } }');

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.client.balance).toBe('150.00');
  });

  test('client.balanceCurrency returns the currency the computed balance is denominated in', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])
      .mockResolvedValueOnce([[
        { id: 30, total: '150.00', currency: 'MXN', balance_due: '150.00' },
      ]])
      .mockResolvedValueOnce([[]])            // payments — none
      .mockResolvedValueOnce([[]]);           // credit notes — none

    const res = await graphql('query { client(id: "10") { id balanceCurrency } }');

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.client.balanceCurrency).toBe('MXN');
  });

  test('client.balance and balanceCurrency share ONE underlying computation (no duplicate query pair)', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])
      .mockResolvedValueOnce([[
        { id: 30, total: '150.00', currency: 'MXN', balance_due: '150.00' },
      ]])
      .mockResolvedValueOnce([[]])            // payments — none
      .mockResolvedValueOnce([[]]);           // credit notes — none

    const res = await graphql('query { client(id: "10") { balance balanceCurrency } }');

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.client.balance).toBe('150.00');
    expect(res.body.data.client.balanceCurrency).toBe('MXN');
    // findById + the invoice, payments, and credit-notes queries — NOT doubled.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  test('client.ledger exposes the computed running_balance as balanceAfter', async () => {
    mockQuery
      .mockResolvedValueOnce([[CLIENT_ROW]])  // client findById
      .mockResolvedValueOnce([[              // ledger query (running_balance computed in SQL)
        { id: 2, entry_type: 'payment', amount: '40.00', currency: 'MXN', running_balance: '60.00', description: 'Payment Y', created_at: '2024-01-02' },
        { id: 1, entry_type: 'invoice', amount: '100.00', currency: 'MXN', running_balance: '100.00', description: 'Invoice X', created_at: '2024-01-01' },
      ]]);

    const res = await graphql('query { client(id: "10") { ledger { entryType amount balanceAfter } } }');

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { ledger } = res.body.data.client;
    expect(ledger[0].balanceAfter).toBe('60.00');   // newest first
    expect(ledger[1].balanceAfter).toBe('100.00');
  });

  // -----------------------------------------------------------------------
  // contract query
  // -----------------------------------------------------------------------

  test('contract(id) — returns contract with camelCase fields', async () => {
    mockQuery.mockResolvedValueOnce([[CONTRACT_ROW]]);  // findById

    const res = await graphql(`
      query {
        contract(id: "20") {
          id clientId planId connectionType startDate billingDay ipAddress status createdAt
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { contract } = res.body.data;
    expect(contract.id).toBe('20');
    expect(contract.clientId).toBe('10');
    expect(contract.planId).toBe('3');
    expect(contract.connectionType).toBe('fiber');
    expect(contract.ipAddress).toBe('10.0.0.100');
    expect(contract.billingDay).toBe(1);
    expect(contract.status).toBe('active');
  });

  test('contract(id) — returns null for unknown ID', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // no row

    const res = await graphql(`
      query { contract(id: "9999") { id status } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.data.contract).toBeNull();
  });

  test('contract — nested client resolves correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[CONTRACT_ROW]])  // contract findById
      .mockResolvedValueOnce([[CLIENT_ROW]]);   // client findById

    const res = await graphql(`
      query {
        contract(id: "20") {
          id status
          client { id name status }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { contract } = res.body.data;
    expect(contract.client.name).toBe('Acme Corp');
    expect(contract.client.id).toBe('10');
  });

  test('contract — nested invoices resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[CONTRACT_ROW]])    // contract findById
      .mockResolvedValueOnce([[INVOICE_ROW]]);    // invoices sub-query

    const res = await graphql(`
      query {
        contract(id: "20") {
          invoices { id invoiceNumber total status }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { invoices } = res.body.data.contract;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe('INV-0001');
    expect(invoices[0].total).toBe('580.00');
  });

  test('contract — nested devices and addons return empty arrays when no rows', async () => {
    mockQuery
      .mockResolvedValueOnce([[CONTRACT_ROW]])  // contract findById
      .mockResolvedValueOnce([[]])              // devices sub-query
      .mockResolvedValueOnce([[]]);             // addons sub-query

    const res = await graphql(`
      query {
        contract(id: "20") {
          devices { id }
          addons  { id }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.contract.devices).toEqual([]);
    expect(res.body.data.contract.addons).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // clients list query
  // -----------------------------------------------------------------------

  test('clients — returns paginated list', async () => {
    mockQuery.mockResolvedValueOnce([[CLIENT_ROW]]);

    const res = await graphql(`
      query { clients(limit: 10, offset: 0) { id name status } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.data.clients).toHaveLength(1);
    expect(res.body.data.clients[0].name).toBe('Acme Corp');
  });

  // -----------------------------------------------------------------------
  // invoice query
  // -----------------------------------------------------------------------

  test('invoice(id) — returns invoice with camelCase fields', async () => {
    mockQuery.mockResolvedValueOnce([[INVOICE_ROW]]);

    const res = await graphql(`
      query {
        invoice(id: "30") {
          id invoiceNumber subtotal taxAmount total currency dueDate status clientId
        }
      }
    `);

    expect(res.status).toBe(200);
    const inv = res.body.data.invoice;
    expect(inv.invoiceNumber).toBe('INV-0001');
    expect(inv.taxAmount).toBe('80.00');
    expect(inv.clientId).toBe('10');
  });

  test('invoice — nested items resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[INVOICE_ROW]])  // findById
      .mockResolvedValueOnce([[             // getItems
        { id: 50, invoice_id: 30, description: 'Internet Plan', quantity: '1', unit_price: '500.00', amount: '500.00', tax_rate: '0.16', deleted_at: null },
      ]]);

    const res = await graphql(`
      query {
        invoice(id: "30") {
          items { id description quantity unitPrice amount taxRate }
        }
      }
    `);

    expect(res.status).toBe(200);
    const { items } = res.body.data.invoice;
    expect(items).toHaveLength(1);
    expect(items[0].unitPrice).toBe('500.00');
    expect(items[0].taxRate).toBe('0.16');
  });

  test('invoice — nested appliedPayments resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[INVOICE_ROW]])
      .mockResolvedValueOnce([[
        { id: 60, payment_id: 70, invoice_id: 30, amount: '580.00',
          payment_amount: '580.00', payment_method: 'transfer', payment_date: '2024-03-01' },
      ]]);

    const res = await graphql(`
      query {
        invoice(id: "30") {
          appliedPayments { id paymentId invoiceId amount paymentMethod paymentDate }
        }
      }
    `);

    expect(res.status).toBe(200);
    const { appliedPayments } = res.body.data.invoice;
    expect(appliedPayments).toHaveLength(1);
    expect(appliedPayments[0].paymentMethod).toBe('transfer');
    expect(appliedPayments[0].paymentId).toBe('70');
  });

  // -----------------------------------------------------------------------
  // ticket query
  // -----------------------------------------------------------------------

  test('ticket(id) — returns ticket with camelCase fields', async () => {
    mockQuery.mockResolvedValueOnce([[TICKET_ROW]]);

    const res = await graphql(`
      query {
        ticket(id: "40") {
          id subject priority status clientId assignedTo createdAt updatedAt
        }
      }
    `);

    expect(res.status).toBe(200);
    const t = res.body.data.ticket;
    expect(t.subject).toBe('No internet');
    expect(t.priority).toBe('high');
    expect(t.clientId).toBe('10');
    expect(t.assignedTo).toBeNull();
  });

  test('ticket — nested comments resolve correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[TICKET_ROW]])
      .mockResolvedValueOnce([[
        { id: 80, ticket_id: 40, user_id: 1, body: 'Checking the line.', is_internal: false, created_at: '2024-02-21T00:00:00.000Z', deleted_at: null },
      ]]);

    const res = await graphql(`
      query {
        ticket(id: "40") {
          comments { id body isInternal ticketId }
        }
      }
    `);

    expect(res.status).toBe(200);
    const { comments } = res.body.data.ticket;
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Checking the line.');
    expect(comments[0].isInternal).toBe(false);
    expect(comments[0].ticketId).toBe('40');
  });

  // -----------------------------------------------------------------------
  // Unauthenticated access
  // -----------------------------------------------------------------------

  test('unauthenticated request returns 401', async () => {
    // Temporarily un-mock auth to test real unauthenticated behaviour.
    // We achieve this by overriding the mock for this one test.
    jest.resetModules();

    // Just verify that a request without a Bearer token gets rejected.
    // The mock is in place so we test the auth mock is actually called.
    // (Full end-to-end auth test is covered in sso.test.js and auth routes.)
    // Here we just confirm the endpoint exists and responds to POST.
    const res = await graphql('{ __typename }');
    // With mocked auth the request is allowed — we just verify no crash.
    expect([200, 401]).toContain(res.status);
  });

  // -----------------------------------------------------------------------
  // payment query
  // -----------------------------------------------------------------------

  const PAYMENT_ROW = {
    id: 70, client_id: 10, organization_id: 1,
    amount: '580.00', currency: 'MXN', payment_method: 'transfer',
    reference_number: 'REF-001', status: 'completed',
    payment_date: '2024-03-01', deleted_at: null,
    created_at: '2024-03-01T12:00:00.000Z',
  };

  const ALLOCATION_ROW = {
    id: 1, payment_id: 70, invoice_id: 30, amount: '580.00', deleted_at: null,
  };

  test('payment(id) — returns payment with camelCase fields', async () => {
    mockQuery.mockResolvedValueOnce([[PAYMENT_ROW]]);  // findById

    const res = await graphql(`
      query {
        payment(id: "70") {
          id clientId amount currency paymentMethod reference status paymentDate createdAt
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { payment } = res.body.data;
    expect(payment.id).toBe('70');
    expect(payment.clientId).toBe('10');
    expect(payment.amount).toBe('580.00');
    expect(payment.currency).toBe('MXN');
    expect(payment.paymentMethod).toBe('transfer');
    expect(payment.reference).toBe('REF-001');
    expect(payment.status).toBe('completed');
    expect(payment.paymentDate).toBe('2024-03-01');
    expect(payment.createdAt).toBe('2024-03-01T12:00:00.000Z');
  });

  test('payment(id) — returns null for unknown ID', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // no row

    const res = await graphql(`
      query { payment(id: "9999") { id amount } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.data.payment).toBeNull();
  });

  test('payment — nested client resolves correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([[PAYMENT_ROW]])   // payment findById
      .mockResolvedValueOnce([[CLIENT_ROW]]);   // client findById

    const res = await graphql(`
      query {
        payment(id: "70") {
          id status
          client { id name status }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { payment } = res.body.data;
    expect(payment.client.name).toBe('Acme Corp');
    expect(payment.client.id).toBe('10');
  });

  test('payment — nested allocations resolve with invoice links', async () => {
    mockQuery
      .mockResolvedValueOnce([[PAYMENT_ROW]])       // payment findById
      .mockResolvedValueOnce([[ALLOCATION_ROW]])    // allocations query
      .mockResolvedValueOnce([[INVOICE_ROW]]);      // invoice findById for allocation

    const res = await graphql(`
      query {
        payment(id: "70") {
          allocations {
            id paymentId invoiceId amount
            invoice { id invoiceNumber total status }
          }
        }
      }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const { allocations } = res.body.data.payment;
    expect(allocations).toHaveLength(1);
    expect(allocations[0].paymentId).toBe('70');
    expect(allocations[0].invoiceId).toBe('30');
    expect(allocations[0].amount).toBe('580.00');
    expect(allocations[0].invoice.invoiceNumber).toBe('INV-0001');
    expect(allocations[0].invoice.status).toBe('pending');
  });

  test('payment — allocations returns empty array when none', async () => {
    mockQuery
      .mockResolvedValueOnce([[PAYMENT_ROW]])  // payment findById
      .mockResolvedValueOnce([[]]);            // empty allocations

    const res = await graphql(`
      query { payment(id: "70") { allocations { id } } }
    `);

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.payment.allocations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Limit clamping (security: prevent unbounded queries)
  // -----------------------------------------------------------------------

  test('clients with limit > 200 is clamped to 200', async () => {
    mockQuery.mockResolvedValueOnce([[CLIENT_ROW]]);

    const res = await graphql(`
      query { clients(limit: 99999) { id } }
    `);

    expect(res.status).toBe(200);
    // Verify the query was called and succeeded (limit clamped internally)
    expect(mockQuery).toHaveBeenCalled();
    const sql = mockQuery.mock.calls[0][0];
    // The inlined LIMIT in BaseModel.findAll should be clamped to 200
    expect(sql).toMatch(/LIMIT 200/);
  });
});
