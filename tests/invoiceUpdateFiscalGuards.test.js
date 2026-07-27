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
  // The tax-coherence guard, reached when an edit REMOVES tax. Default no-op so
  // the cases below still exercise the hook's own arithmetic; the zero-tax cases
  // override it. It MUST be listed — a partial mock of a service turns a new
  // call site into "undefined is not a function", surfacing as a 500 on the
  // edit rather than as a missing-guard failure. (Same trap as #550.)
  assertTaxCoherent: jest.fn().mockResolvedValue(undefined),
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
    if (/SELECT tax_exempt FROM clients/.test(sql)) {
      // client 43 is the exempt one; client 42 follows the `exempt` switch
      const isExempt = Number(params[0]) === 43 ? true : exempt;
      return [[{ tax_exempt: isExempt ? 1 : 0 }]];
    }
    if (/SELECT id FROM clients/.test(sql)) {
      // clients 42 and 43 belong to org 5; anything else does not
      return [[42, 43].includes(Number(params[0])) ? [{ id: Number(params[0]) }] : []];
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
  it('rejects an edit that raises tax on an exempt client’s invoice (422 CLIENT_TAX_EXEMPT)', async () => {
    wireDb({ exempt: true });
    // coherent figures (1250 × 16% = 200) so the rate check passes and the
    // exemption check is what rejects it
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1250, tax_amount: 200, total: 1450, tax_rate: 0.16 });
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

// ---------------------------------------------------------------------------
// Regression cover for the review findings on the first cut of this guard.
// ---------------------------------------------------------------------------

describe('the guard fires on a real CHANGE, not on field presence', () => {
  // The invoice Edit modal re-sends subtotal/tax_amount/total on every save.
  // A presence-based guard 422'd a due-date edit on any stamped invoice while
  // the Edit button still rendered — visible-but-forbidden, amounts identical.
  it('allows a due_date edit that re-sends UNCHANGED amounts on a stamped invoice', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).put('/api/v1/invoices/900').send({
      subtotal: 1000, tax_amount: 160, total: 1160, due_date: '2026-09-01',
    });
    expect(res.status).toBe(200);
  });

  it('tolerates the string/number DECIMAL round-trip when comparing', async () => {
    wireDb({ liveCfdi: true });
    // stored values are strings ('1000.00'); the client sends numbers
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000.0, tax_amount: 160.0, total: 1160.0, status: 'paid' });
    expect(res.status).toBe(200);
  });

  it('an equivalent tax_rate expressed as a percent is not a change', async () => {
    wireDb({ liveCfdi: true });
    // stored 0.1600; caller sends 16 (percent) — same rate after normalization
    const res = await request(app).patch('/api/v1/invoices/900').send({ tax_rate: 16 });
    expect(res.status).toBe(200);
  });

  it('still blocks a REAL amount change on a stamped invoice', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 160, total: 1161 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });
});

describe('client_id is fiscally frozen too', () => {
  it('blocks moving a STAMPED invoice to a different client (receptor is filed)', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900').send({ client_id: 43 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });

  it('blocks moving a TAXED invoice onto an IVA-exempt client', async () => {
    wireDb({ liveCfdi: false });
    // client 43 is exempt; the invoice carries 160.00 of tax
    const res = await request(app).patch('/api/v1/invoices/900').send({ client_id: 43 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLIENT_TAX_EXEMPT');
  });

  it('re-sending the SAME client_id is not a change', async () => {
    wireDb({ liveCfdi: true });
    const res = await request(app).patch('/api/v1/invoices/900').send({ client_id: 42 });
    expect(res.status).toBe(200);
  });
});

describe('an invoice can never be moved to another organization', () => {
  it('rejects organization_id (fillable, but undeclared in the update schema)', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900').send({ organization_id: 9 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_IMMUTABLE');
  });
});

describe('exemption is enforced going-forward, not retroactively', () => {
  it('does NOT brick an older correctly-taxed invoice after its client is flagged exempt', async () => {
    wireDb({ exempt: true });
    // client 42 is now exempt; this edit does not add tax, it only moves the due date
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 160, total: 1160, due_date: '2026-10-01' });
    expect(res.status).toBe(200);
  });

  it('still rejects an edit that INCREASES tax for an exempt client', async () => {
    wireDb({ exempt: true });
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1250, tax_amount: 200, total: 1450 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLIENT_TAX_EXEMPT');
  });
});

describe('legacy inconsistent rows stay repairable', () => {
  it('does not impose the rate invariant on a row that was already inconsistent', async () => {
    wireDb();
    // stored row is made inconsistent: tax 160 with rate 0 (a legacy 0%-rate row)
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/SELECT tax_exempt FROM clients/.test(sql)) return [[{ tax_exempt: 0 }]];
      if (/SELECT id FROM clients/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM `?invoices`? WHERE id/.test(sql)) {
        return [[{ ...STORED, tax_rate: '0.0000' }]];
      }
      if (/^UPDATE `?invoices`?/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    // repairing the amounts without restating the rate must not 422
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 2000, tax_amount: 320, total: 2320 });
    expect(res.status).toBe(200);
  });
});

describe('the rate is kept describing the amounts', () => {
  it('back-derives tax_rate when amounts change and no rate is supplied', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 2000, tax_amount: 320, total: 2320 });
    expect(res.status).toBe(200);
    const writes = db.query.mock.calls.filter(([sql]) => /^UPDATE `?invoices`?/i.test(sql));
    const params = writes.flatMap(([, p]) => p || []);
    expect(params.some((v) => Number(v) === 0.16)).toBe(true); // 320/2000
  });

  it('rejects an asserted rate that contradicts the amounts', async () => {
    wireDb();
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 300, total: 1300, tax_rate: 0.16 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TAX_INCONSISTENT');
  });
});

// ---------------------------------------------------------------------------
// DELETE / restore — the sibling of the update guard (#532)
// ---------------------------------------------------------------------------
// Both routes went straight to the generic crudController with no fiscal check
// at all, so an invoice whose CFDI is vigente at SAT could be soft-deleted, and
// restored, while the filed XML stayed on record. The update path has been
// guarded since #532; these are the doors that were left open.
describe('invoice delete and restore respect a live CFDI', () => {
  it('the routes declare beforeDelete and beforeRestore guards', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/routes/invoices.js'), 'utf8',
    );
    const opts = src.slice(src.indexOf('const ctrl = crudController(Invoice, {'));
    const block = opts.slice(0, opts.indexOf('\n});'));
    expect(block).toMatch(/beforeDelete:/);
    expect(block).toMatch(/beforeRestore:/);
    // Both must go through the same helper the rest of the file uses.
    expect(block.match(/assertNoLiveCfdi/g) || []).toHaveLength(2);
  });

  it('does NOT also block deleting a terminal invoice', () => {
    // A void or SAT-cancelled invoice carries no live CFDI, and archiving one is
    // exactly what an operator should be able to do. Calling
    // assertInvoiceNotTerminal here would make cancelled invoices permanently
    // undeletable — a guard too broad is its own bug.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/routes/invoices.js'), 'utf8',
    );
    const opts = src.slice(src.indexOf('const ctrl = crudController(Invoice, {'));
    const block = opts.slice(0, opts.indexOf('\n});'));
    const del = block.slice(block.indexOf('beforeDelete:'), block.indexOf('beforeRestore:'));
    expect(del).not.toMatch(/assertInvoiceNotTerminal/);
  });

  it('crudController runs the guards BEFORE the write', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/controllers/crudController.js'), 'utf8',
    );
    // beforeDelete fires between the fetch and the delete...
    expect(src.indexOf('if (beforeDeleteHook) await beforeDeleteHook(old, req)'))
      .toBeLessThan(src.indexOf('await Model.delete(req.params.id, req.orgId)'));
    // ...and beforeRestore before the restore. An after* hook could not serve
    // either purpose: the row is already gone, and its errors are swallowed.
    expect(src.indexOf('if (beforeRestoreHook) await beforeRestoreHook(req)'))
      .toBeLessThan(src.indexOf('const record = await Model.restore(req.params.id, req.orgId)'));
  });
});

// ---------------------------------------------------------------------------
// An edit may not STRIP the tax off an invoice (the mirror of the exempt guard)
// ---------------------------------------------------------------------------
// PATCH {tax_amount: 0, total: 1000} on a 1000/160/1160 invoice passed every
// existing check — TOTAL_INCONSISTENT is satisfied (1000 = 1000 + 0) and the
// back-derive branch helpfully rewrote tax_rate to 0. The invoice then stamped
// ObjetoImp='01' with no Impuestos node, telling SAT the sale was not taxable.
// POST /invoices rejects these exact figures (#549); this was the same hole
// through the update door, and it is the fully UI-driven path.
describe('PATCH /api/v1/invoices/:id — an edit cannot silently zero-rate', () => {
  const billingService = require('../src/services/billingService');

  it('consults the tax guard when the edit removes tax', async () => {
    wireDb();
    await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 0, total: 1000 });
    expect(billingService.assertTaxCoherent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ taxAmount: 0, docType: 'invoice' }),
    );
  });

  it('propagates the guard 422 instead of writing', async () => {
    wireDb();
    const { AppError } = require('../src/utils/errors');
    billingService.assertTaxCoherent.mockRejectedValueOnce(
      new AppError('This invoice carries no tax, but 16% applies to this client.', 422, 'TAX_REQUIRED'),
    );
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 1000, tax_amount: 0, total: 1000 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TAX_REQUIRED');
    const writes = db.query.mock.calls.filter(c => /^UPDATE `?invoices`?/i.test(c[0]));
    expect(writes).toHaveLength(0);
  });

  it('does NOT consult it when the invoice was already untaxed', async () => {
    // The "going forward only" guarantee. A legacy or legitimately untaxed row
    // must not be re-examined, or editing its due date would 422 forever.
    wireDb();
    const stored = { ...STORED, tax_amount: '0.00', total: '1000.00', tax_rate: '0.0000' };
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents/.test(sql)) return [[]];
      if (/SELECT \* FROM `?invoices`? WHERE id/.test(sql)) return [[stored]];
      if (/^UPDATE `?invoices`?/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    db.execute.mockImplementation(db.query.getMockImplementation());
    // Must edit a FROZEN field. A due_date patch returns early at the
    // `changed.length === 0` check and never reaches the guard under EITHER
    // version — which made the first draft of this test pass against the
    // mutation it was written to catch.
    const res = await request(app).patch('/api/v1/invoices/900')
      .send({ subtotal: 2000, tax_amount: 0, total: 2000 });
    expect(res.status).toBe(200);
    expect(billingService.assertTaxCoherent).not.toHaveBeenCalled();
  });

  it('does NOT consult it when the edit leaves tax in place', async () => {
    wireDb();
    await request(app).patch('/api/v1/invoices/900').send({ notes: 'called the client' });
    expect(billingService.assertTaxCoherent).not.toHaveBeenCalled();
  });
});
