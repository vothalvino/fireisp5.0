// =============================================================================
// FireISP 5.0 — PAC environment scoping
// =============================================================================
// Stamping and cancellation use ONLY the PAC rows matching the org's fiscal
// environment (organization_mx_profiles.pac_environment). Sandbox and production
// credentials/endpoints differ per PAC and live on separate rows, so this single
// org switch selects the whole set — a sandbox row must never stamp a live
// invoice, and priority must not let a wrong-environment PAC win. Driven through
// the REAL stack (httpRequest → a stand-in SW server); the db mock honors the
// environment parameter so it mirrors the real WHERE clause.
// =============================================================================

const http = require('http');
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

const DOC = { id: 9, organization_id: 5, uuid: 'AAAAAAAA-0000-4000-8000-AAAAAAAAAAAA', xml_content: '<cfdi:Comprobante Version="4.0"/>', sat_status: 'draft', invoice_id: null };

let sandServer; let prodServer;
beforeAll(async () => {
  sandServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { uuid: 'SAND-1', cfdi: '<s/>', selloSAT: 's' } })); });
  prodServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { uuid: 'PROD-1', cfdi: '<s/>', selloSAT: 's' } })); });
  await new Promise(r => sandServer.listen(0, '127.0.0.1', r));
  await new Promise(r => prodServer.listen(0, '127.0.0.1', r));
});
afterAll(async () => { await new Promise(r => sandServer.close(r)); await new Promise(r => prodServer.close(r)); });
const sandBase = () => `http://127.0.0.1:${sandServer.address().port}`;
const prodBase = () => `http://127.0.0.1:${prodServer.address().port}`;

let nextId = 700;
function pac(over) {
  return { id: nextId++, provider_name: 'sw_sapien', seal_mode: 'pac', token_encrypted: 'tok', status: 'active', priority: 100, ...over };
}

// The mock mirrors the real SQL: pac_providers is filtered by params[1] (the
// environment the service scoped the query to). If the service forgot the
// filter, the mock would still hand back only the queried environment — so the
// assertions below turn on which environment the service actually queries AND
// which provider it then selects.
function wire(orgEnv, pacs) {
  db.query.mockImplementation(async (sql, params) => {
    if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ ...DOC }]];
    if (/FROM organization_mx_profiles/.test(sql)) return [[{ pac_environment: orgEnv }]];
    if (/FROM pac_providers/.test(sql)) {
      const env = params[1];
      return [pacs.filter(p => p.environment === env).map(p => ({ ...p }))];
    }
    if (/cfdi_cancellations/.test(sql)) return [{ insertId: 1 }];
    return [{ affectedRows: 1 }];
  });
}

beforeEach(() => { jest.clearAllMocks(); });

describe('PAC environment scoping — stamping', () => {
  test('production org stamps via the production PAC even when a sandbox PAC has lower priority', async () => {
    // Sandbox priority 5 would WIN on priority alone; the env filter must exclude it.
    const sand = pac({ environment: 'sandbox', priority: 5, api_url: sandBase() });
    const prod = pac({ environment: 'production', priority: 10, api_url: prodBase() });
    wire('production', [sand, prod]);
    const res = await cfdiService.stamp(9);
    expect(res).toMatchObject({ uuid: 'PROD-1', status: 'vigente' });
  }, 20000);

  test('sandbox org stamps via the sandbox PAC', async () => {
    const sand = pac({ environment: 'sandbox', priority: 10, api_url: sandBase() });
    const prod = pac({ environment: 'production', priority: 5, api_url: prodBase() });
    wire('sandbox', [sand, prod]);
    const res = await cfdiService.stamp(9);
    expect(res).toMatchObject({ uuid: 'SAND-1', status: 'vigente' });
  }, 20000);

  test('no PAC in the active environment → actionable error naming the mode (not a silent fallback)', async () => {
    // Only a sandbox PAC exists, but the org is in production mode.
    const sand = pac({ environment: 'sandbox', priority: 10, api_url: sandBase() });
    wire('production', [sand]);
    await expect(cfdiService.stamp(9)).rejects.toThrow(/production mode/);
  }, 20000);

  test('org with no fiscal profile defaults to sandbox (never accidentally production)', async () => {
    const sand = pac({ environment: 'sandbox', priority: 10, api_url: sandBase() });
    const prod = pac({ environment: 'production', priority: 5, api_url: prodBase() });
    // No organization_mx_profiles row → orgPacEnvironment falls back to 'sandbox'.
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ ...DOC }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[]];
      if (/FROM pac_providers/.test(sql)) return [[sand, prod].filter(p => p.environment === params[1]).map(p => ({ ...p }))];
      return [{ affectedRows: 1 }];
    });
    const res = await cfdiService.stamp(9);
    expect(res.uuid).toBe('SAND-1');
  }, 20000);
});

describe('PAC environment scoping — cancellation', () => {
  test('production org cancels via the production PAC (sandbox row ignored)', async () => {
    const stampedDoc = { ...DOC, sat_status: 'vigente', serie: 'A', folio: 9, total: '116.00' };
    const sand = pac({ environment: 'sandbox', priority: 5, api_url: sandBase() });
    const prod = pac({ environment: 'production', priority: 10, api_url: prodBase() });
    // SW cancel hits /cfdi33/cancel/... with an acuse; both servers answer, but
    // only the production one must be queried. Capture which server got the call.
    let sandHit = false; let prodHit = false;
    sandServer.removeAllListeners('request');
    prodServer.removeAllListeners('request');
    sandServer.on('request', (req, res) => { sandHit = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { acuse: '<Acuse><EstatusUUID>201</EstatusUUID></Acuse>', fechaCancelacion: '2026-07-22' } })); });
    prodServer.on('request', (req, res) => { prodHit = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { acuse: '<Acuse><EstatusUUID>201</EstatusUUID></Acuse>', fechaCancelacion: '2026-07-22' } })); });

    db.query.mockImplementation(async (sql, params) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[stampedDoc]];
      if (/FROM organization_mx_profiles WHERE organization_id = \? AND deleted_at/.test(sql) && /pac_environment/.test(sql)) return [[{ pac_environment: 'production' }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ rfc: 'EKU9003173C9', razon_social: 'X', regimen_fiscal: '601', codigo_postal_fiscal: '42501' }]];
      if (/FROM pac_providers/.test(sql)) return [[sand, prod].filter(p => p.environment === params[1]).map(p => ({ ...p }))];
      if (/cfdi_cancellations/.test(sql)) return [{ insertId: 1 }];
      return [{ affectedRows: 1 }];
    });

    await cfdiService.cancel(9, '02');
    expect(prodHit).toBe(true);
    expect(sandHit).toBe(false);
  }, 20000);
});
