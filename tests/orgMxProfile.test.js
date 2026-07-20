// =============================================================================
// FireISP 5.0 — Organization MX fiscal identity (emisor) routes
// =============================================================================
// GET/PUT /organizations/:id/mx-profile — the org's SAT taxpayer identity that
// cfdiService joins as cfdi:Emisor at XML-generation time. Gated on the TARGET
// org's locale (not the caller's active org). Also covers the client
// mx-profile org-ownership fix (cross-tenant RFC read/write was possible).
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
// Mutable so individual tests can drop the legacy-admin bypass.
const AUTH_STATE = { role: 'admin' };
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: AUTH_STATE.role }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/models/Client', () => ({
  findByIdOrFail: jest.fn(),
  getMxProfile: jest.fn(),
}));

const db = require('../src/config/database');
const Client = require('../src/models/Client');
const app = require('../src/app');

const PROFILE_ROW = {
  id: 3, organization_id: 5, rfc: 'EKU9003173C9', razon_social: 'Escuela Kemper Urgate SA de CV',
  regimen_fiscal: '601', codigo_postal_fiscal: '26015', colonia: null, municipio: null,
  exterior_number: null, interior_number: null,
  cfdi_serie_ingreso: 'A', cfdi_serie_egreso: 'E', cfdi_serie_pago: 'P', cfdi_folio_next: 1,
};

const VALID_BODY = {
  rfc: 'EKU9003173C9', razon_social: 'Escuela Kemper Urgate SA de CV',
  regimen_fiscal: '601', codigo_postal_fiscal: '26015',
};

// resetAllMocks (not clearAllMocks): a test that 403s before consuming its
// queued once-values must not leak them into the next test.
beforeEach(() => { jest.resetAllMocks(); AUTH_STATE.role = 'admin'; });

describe('GET /organizations/:id/mx-profile', () => {
  test('returns the profile for an MX-locale org', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])   // Organization.getLocale
      .mockResolvedValueOnce([[PROFILE_ROW]]);        // profile SELECT
    const res = await request(app).get('/api/v1/organizations/5/mx-profile');
    expect(res.status).toBe(200);
    expect(res.body.data.rfc).toBe('EKU9003173C9');
  });

  test('returns null (200) when the MX org has no profile yet', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/v1/organizations/5/mx-profile');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('404s REGION_DISABLED for a global-locale org — gates on the TARGET org', async () => {
    db.query.mockResolvedValueOnce([[{ locale: 'global' }]]);
    const res = await request(app).get('/api/v1/organizations/1/mx-profile');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REGION_DISABLED');
  });
});

describe('PUT /organizations/:id/mx-profile', () => {
  test('creates the profile on first save (INSERT path, serie defaults applied)', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])   // getLocale
      .mockResolvedValueOnce([[]])                    // no existing profile
      .mockResolvedValueOnce([{ insertId: 3 }])       // INSERT
      .mockResolvedValueOnce([[PROFILE_ROW]]);        // read-back
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.data.rfc).toBe('EKU9003173C9');
    const insert = db.query.mock.calls.find(c => /INSERT INTO organization_mx_profiles/.test(c[0]));
    expect(insert).toBeTruthy();
    expect(insert[1]).toContain('EKU9003173C9');
    expect(insert[0]).toContain("COALESCE(?, 'A')"); // serie defaults preserved
  });

  test('updates in place on subsequent saves (UPDATE path)', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[{ id: 3 }]])           // existing profile
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE
      .mockResolvedValueOnce([[PROFILE_ROW]]);        // read-back
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send({ ...VALID_BODY, colonia: 'Centro' });
    expect(res.status).toBe(200);
    const update = db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/.test(c[0]));
    expect(update).toBeTruthy();
    expect(update[1]).toContain('Centro');
  });

  test('rejects an incomplete body (validation) before any query', async () => {
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send({ rfc: 'EKU9003173C9' });
    expect(res.status).toBe(422);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('404s for a global-locale org', async () => {
    db.query.mockResolvedValueOnce([[{ locale: 'global' }]]);
    const res = await request(app).put('/api/v1/organizations/1/mx-profile').send(VALID_BODY);
    expect(res.status).toBe(404);
    expect(db.query.mock.calls.find(c => /organization_mx_profiles/.test(c[0]))).toBeFalsy();
  });
});

describe('client mx-profile org-ownership (cross-tenant fix)', () => {
  test('GET 404s when the client belongs to another org — profile never read', async () => {
    const { NotFoundError } = require('../src/utils/errors');
    Client.findByIdOrFail.mockRejectedValue(new NotFoundError('Client'));
    const res = await request(app).get('/api/v1/clients/999/mx-profile');
    expect(res.status).toBe(404);
    expect(Client.findByIdOrFail).toHaveBeenCalledWith('999', 1); // org-scoped check ran
    expect(Client.getMxProfile).not.toHaveBeenCalled();
  });

  test('PUT 404s cross-org before any write', async () => {
    const { NotFoundError } = require('../src/utils/errors');
    Client.findByIdOrFail.mockRejectedValue(new NotFoundError('Client'));
    const res = await request(app).put('/api/v1/clients/999/mx-profile').send({
      rfc: 'XAXX010101000', razon_social: 'X', regimen_fiscal: '616', codigo_postal_fiscal: '01000',
    });
    expect(res.status).toBe(404);
    expect(Client.getMxProfile).not.toHaveBeenCalled();
    expect(db.query.mock.calls.find(c => /client_mx_profiles/.test(c[0]))).toBeFalsy();
  });

  test('GET still works for the caller org own client', async () => {
    Client.findByIdOrFail.mockResolvedValue({ id: 10, organization_id: 1 });
    Client.getMxProfile.mockResolvedValue({ client_id: 10, rfc: 'XAXX010101000' });
    const res = await request(app).get('/api/v1/clients/10/mx-profile');
    expect(res.status).toBe(200);
    expect(res.body.data.rfc).toBe('XAXX010101000');
  });
});

describe('cross-tenant + partial-update semantics', () => {
  test('403s a non-platform-admin touching a DIFFERENT org fiscal identity', async () => {
    AUTH_STATE.role = 'billing'; // no legacy-admin bypass; caller org is 1
    const res = await request(app).get('/api/v1/organizations/5/mx-profile');
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled(); // refused before any lookup
  });

  test('a non-admin CAN manage their own org (id matches req.orgId)', async () => {
    AUTH_STATE.role = 'billing';
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[PROFILE_ROW]]);
    const res = await request(app).get('/api/v1/organizations/1/mx-profile');
    expect(res.status).toBe(200);
  });

  test('omitted address keys leave stored values UNCHANGED (not nulled)', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[PROFILE_ROW]]);
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send(VALID_BODY); // no address keys
    expect(res.status).toBe(200);
    const update = db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/.test(c[0]));
    expect(update[0]).not.toMatch(/colonia|municipio|exterior_number|interior_number/);
  });

  test('an explicitly-sent empty address field clears to NULL', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[PROFILE_ROW]]);
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send({ ...VALID_BODY, colonia: '' });
    expect(res.status).toBe(200);
    const update = db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/.test(c[0]));
    expect(update[0]).toContain('colonia = ?');
    // The colonia param (right after the 4 identity params) is NULL
    expect(update[1][4]).toBeNull();
  });

  test('an empty serie value is ignored (NOT NULL column keeps its stored value)', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[PROFILE_ROW]]);
    const res = await request(app).put('/api/v1/organizations/5/mx-profile').send({ ...VALID_BODY, cfdi_serie_ingreso: '' });
    expect(res.status).toBe(200);
    const update = db.query.mock.calls.find(c => /UPDATE organization_mx_profiles/.test(c[0]));
    expect(update[0]).not.toContain('cfdi_serie_ingreso');
  });
});

describe('POST /cfdi-documents — linked-record org ownership', () => {
  const CFDI_BODY = { client_id: 55, uso_cfdi: 'G03', tipo_comprobante: 'I', total: 116 };

  test('404s when client_id belongs to another org — nothing inserted', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]]) // requireMxLocale → getLocale
      .mockResolvedValueOnce([[]]);                // ownership SELECT: not found in caller org
    const res = await request(app).post('/api/v1/cfdi-documents').send(CFDI_BODY);
    expect(res.status).toBe(404);
    const sqls = db.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).not.toMatch(/INSERT INTO cfdi_documents/);
  });

  test('404s a foreign invoice_id even when the client is owned', async () => {
    db.query
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[{ id: 55 }]])  // client owned
      .mockResolvedValueOnce([[]]);           // invoice NOT owned
    const res = await request(app).post('/api/v1/cfdi-documents').send({ ...CFDI_BODY, invoice_id: 999 });
    expect(res.status).toBe(404);
    const sqls = db.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).not.toMatch(/INSERT INTO cfdi_documents/);
  });
});
