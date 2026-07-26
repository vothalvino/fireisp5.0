// =============================================================================
// FireISP 5.0 — Fiscal guards on the invoice UPDATE path (PUT/PATCH)
// =============================================================================
// The update path was the one live route that could violate "an already-stamped
// invoice is immutable". `assertInvoiceNotTerminal` blocks only the void and
// cancelled statuses, but stamping never changes `status` — so an invoice whose
// CFDI is vigente at SAT sat at issued/sent/paid and could have its subtotal,
// tax and total rewritten, leaving the row disagreeing with the immutable XML
// held by the client and SAT. `assertNoLiveCfdi` already existed but was wired
// only into the line-item routes.
//
// The same gap also let PATCH bypass the create-time IVA-exemption check, write
// an unnormalized percent into the DECIMAL(5,4) tax_rate column, and re-point an
// invoice at another tenant's client.
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 8, role: 'admin' }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 5; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/billingService', () => ({
  // real normalization — the guard depends on it
  invoiceTaxFraction: (r) => { const n = parseFloat(r) || 0; return n > 1 ? n / 100 : n; },
  refreshInvoicePaidStatus: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/models/Organization', () => ({ getCurrency: jest.fn().mockResolvedValue('MXN') }));

const db = require('../src/config/database');
const app = require('../src/app');

// A stored invoice: 1000 + 16% IVA = 1160, client 42, status 'issued'
// (NOT terminal — this is exactly the state a stamped invoice sits in).
const STORED = {
  id: 900,
  organization_id: 5,
  client_id: 42,
  invoice_number: 'INV-000042',
  status: 'issued',
  subtotal: '1000.00',
  tax_amount: '160.00',
  total: '1160.00',
  tax_rate: '0.1600',
  currency: 'MXN',
};

/**
 * @param {object} o
 * @param {boolean} o.liveCfdi   invoice has a CFDI in draft/vigente/cancel_pending
 * @param {boolean} o.exempt     client 42 is IVA-exempt
 * @param {boolean} o.foreignClient  client 77 does NOT belong to org 5
 */
function wireDb({ liveCfdi = false, exempt = false } = {}) {
  const updated = { ...STORED };
  db.query.mockImplementation(async (sql, params) => {
    if (/FROM cfdi_documents/.test(sql)) return [liveCfdi ? [{ id: 31 }] : []];
    if (/SELECT tax_exempt FROM clients/.test(sql)) return [[{ tax_exempt: exempt ? 1 : 0 }]];
    if (/SELECT id FROM clients/.test(sql)) {
      // client 42 belongs to org 5; anything else does not
      return [Number(params[0]) === 42 ? [{ id: 42 }] : []];
    }
    if (/SELECT \* FROM `?invoices`? WHERE id/.test(sql)) return [[updated]];
    if (/^UPDATE `?invoices`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
  return updated;
}

beforeEach(() => jest.clearAllMocks());

describe('PATCH /api/v1/invoices/:id — stamped invoices are fiscally frozen', () => {
  it('rejects an amount edit when a vigente CFDI exists (422 CFDI_STAMPED)', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900').send({ subtotal: 500 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });

  it('rejects a tax_amount edit on a stamped invoice', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900').send({ tax_amount: 0, total: 1000 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });

  it('PUT is guarded too, not just PATCH', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).put('/api/v1/invoices/900').send({ total: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });

  it('allows a NON-money edit on a stamped invoice (notes/due_date stay editable)', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900').send({ notes: 'called the client' });
    expect(res.status).toBe(200);
  });

  it('allows an amount edit when no CFDI exists', async () => {
    wireDb({ liveCfdi: false });
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 2000, tax_amount: 320, total: 2320 });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/v1/invoices/:id — IVA exemption cannot be bypassed', () => {
  it('rejects putting tax on an exempt client’s invoice (422 CLIENT_TAX_EXEMPT)', async () => {
    wireDb({ exempt: true });
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 160, total: 1160 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLIENT_TAX_EXEMPT');
  });

  it('allows zeroing tax for an exempt client', async () => {
    wireDb({ exempt: true });
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 0, total: 1000 });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/v1/invoices/:id — tax_rate percent is normalized', () => {
  it('normalizes 16 (percent) to 0.16 before it reaches DECIMAL(5,4)', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 160, total: 1160, tax_rate: 16 });
    expect(res.status).toBe(200);
    // the value handed to the model must be the fraction, never the raw 16
    const writes = db.query.mock.calls.filter(([sql]) => /^UPDATE `?invoices`?/i.test(sql));
    const params = writes.flatMap(([, p]) => p || []);
    expect(params).not.toContain(16);
    expect(params.some((v) => Number(v) === 0.16)).toBe(true);
  });

  it('rejects a rate that disagrees with the tax it is paired with', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 300, total: 1300, tax_rate: 16 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TAX_INCONSISTENT');
  });
});

describe('PATCH /api/v1/invoices/:id — merged-figure consistency', () => {
  it('rejects a partial edit that leaves subtotal + tax ≠ total', async () => {
    wireDb();
    // subtotal alone changes; stored tax 160 + new 2000 ≠ stored total 1160
    const res = await request(app).patch('/api/v1/invoices/900').send({ subtotal: 2000 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOTAL_INCONSISTENT');
  });
});

describe('PATCH /api/v1/invoices/:id — cross-tenant client swap', () => {
  it('rejects re-pointing the invoice at another org’s client (422 CLIENT_NOT_FOUND)', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900').send({ client_id: 77 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLIENT_NOT_FOUND');
  });
});
