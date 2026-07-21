// =============================================================================
// FireISP 5.0 — stamp() with seal_mode='local' (Phase 3)
// =============================================================================
// The org's ACTIVE CSD seals the XML in-process and the SEALED document goes
// to SW's stamp-only tier as a multipart file upload (probe-verified live:
// every JSON body is rejected with "Xml CFDI no proporcionado"). A local HTTP
// server stands in for SW — pac.api_url is honored now (it was silently
// ignored), which is also what makes this testable.
// =============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiSealService = require('../src/services/cfdiSealService');
const cfdiService = require('../src/services/cfdiService');

const FIX = path.join(__dirname, 'fixtures/csd');
const MATERIAL = cfdiSealService.csdStorageMaterial(
  fs.readFileSync(path.join(FIX, 'EKU9003173C9.cer')),
  fs.readFileSync(path.join(FIX, 'EKU9003173C9.key')),
  '12345678a',
);

const UNSEALED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0" Serie="A" Folio="7" Fecha="2026-07-20T14:00:00" TipoDeComprobante="I" Exportacion="01"
  LugarExpedicion="42501" Moneda="MXN" SubTotal="100.00" Total="116.00" FormaPago="99" MetodoPago="PPD">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="MISC491214B86" Nombre="CECILIA MIRANDA SANCHEZ" DomicilioFiscalReceptor="01010" RegimenFiscalReceptor="612" UsoCFDI="G03" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="81161700" Cantidad="1.0000" ClaveUnidad="E48" Descripcion="Internet — señal óptima" ValorUnitario="100.0000" Importe="100.0000" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="100.0000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.0000" /></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16.00"><cfdi:Traslados><cfdi:Traslado Base="100.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.00" /></cfdi:Traslados></cfdi:Impuestos>
</cfdi:Comprobante>`;

const CSD_ROW = {
  id: 1, organization_id: 5, rfc: 'EKU9003173C9',
  cer_pem: MATERIAL.cer_pem,
  key_pem_encrypted: MATERIAL.key_pem,       // no ENCRYPTION_KEY in tests → stored as-is
  passphrase_encrypted: '12345678a',
  is_active: 1, status: 'active',
  valid_to: new Date(Date.now() + 200 * 86400000),
};

function wireDb({ pac, csdRow = CSD_ROW } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM cfdi_documents WHERE id/.test(sql)) {
      return [[{ id: 7, organization_id: 5, xml_content: UNSEALED_XML, sat_status: 'draft', invoice_id: null }]];
    }
    if (/FROM pac_providers/.test(sql)) return [[{ ...pac }]];
    if (/FROM csd_certificates/.test(sql)) return [csdRow ? [{ ...csdRow }] : []];
    return [{ affectedRows: 1 }];
  });
}

let server; let captured;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      captured = { url: req.url, headers: req.headers, body };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'success',
        data: {
          uuid: 'aaaa1111-2222-4333-8444-555566667777',
          cfdi: '<sealed-with-tfd TimbreFiscalDigital/>',
          selloSAT: 'SAT_SEAL', cadenaOriginalSAT: '||1.1|…||',
        },
      }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

function localPac(overrides = {}) {
  return {
    id: 2, provider_name: 'sw_sapien', environment: 'sandbox', seal_mode: 'local',
    api_url: `http://127.0.0.1:${server.address().port}`,
    token_encrypted: 'TESTTOKEN', status: 'active',
    ...overrides,
  };
}

beforeEach(() => { jest.clearAllMocks(); captured = null; });

describe("stamp() with seal_mode='local'", () => {
  test('seals with the org CSD and posts SEALED XML as multipart to the stamp-only tier', async () => {
    wireDb({ pac: localPac() });
    const result = await cfdiService.stamp(7);

    expect(result).toMatchObject({ uuid: 'aaaa1111-2222-4333-8444-555566667777', status: 'vigente' });
    expect(captured.url).toBe('/cfdi33/stamp/v4');
    expect(captured.headers['content-type']).toContain('multipart/form-data; boundary=');
    expect(captured.headers.authorization).toBe('Bearer TESTTOKEN');
    expect(captured.body).toContain('name="xml"; filename="cfdi.xml"');
    // the uploaded XML must be SEALED by OUR engine and verify against itself
    const uploaded = captured.body.split('\r\n\r\n')[1].split('\r\n--')[0];
    expect(uploaded).toContain('NoCertificado="30001000000500003416"');
    expect(uploaded).toMatch(/Sello="[A-Za-z0-9+/=]+"/);
    expect(cfdiSealService.verifySeal(uploaded)).toBe(true);
    // and the PAC's returned (TFD-bearing) XML is what gets stored
    const upd = db.query.mock.calls.find(c => /UPDATE cfdi_documents/.test(c[0]) && /signed_xml/.test(c[0]));
    expect(upd[1]).toContain('<sealed-with-tfd TimbreFiscalDigital/>');
  });

  test('422 CSD_MISSING when the org has no active certificate', async () => {
    wireDb({ pac: localPac(), csdRow: null });
    await expect(cfdiService.stamp(7)).rejects.toMatchObject({ statusCode: 422, code: 'CSD_MISSING' });
  });

  test('422 CSD_EXPIRED when the active certificate lapsed', async () => {
    wireDb({ pac: localPac(), csdRow: { ...CSD_ROW, valid_to: new Date('2020-01-01') } });
    await expect(cfdiService.stamp(7)).rejects.toMatchObject({ statusCode: 422, code: 'CSD_EXPIRED' });
  });

  test('422 CSD_TEST_IN_PRODUCTION: a SAT test CSD never stamps against a production PAC', async () => {
    wireDb({ pac: localPac({ environment: 'production' }) });
    await expect(cfdiService.stamp(7)).rejects.toMatchObject({ statusCode: 422, code: 'CSD_TEST_IN_PRODUCTION' });
  });

  test("422 SEAL_MODE_UNSUPPORTED for providers without a local-seal adapter yet", async () => {
    wireDb({ pac: localPac({ provider_name: 'finkok' }) });
    await expect(cfdiService.stamp(7)).rejects.toMatchObject({ statusCode: 422, code: 'SEAL_MODE_UNSUPPORTED' });
  });

  test('cancel error for a local-sealed doc points at the SW-vault requirement', async () => {
    // The stand-in returns an error status for cancel; the message must gain
    // the local-seal context (SW signs cancellations with its vaulted CSD).
    const errServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', message: 'No fue posible obtener el Certificado' }));
    });
    await new Promise(r => errServer.listen(0, '127.0.0.1', r));
    const port = errServer.address().port;
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ id: 7, organization_id: 5, uuid: 'aaaa1111-2222-4333-8444-555566667777', sat_status: 'vigente', invoice_id: null }]];
      if (/FROM pac_providers/.test(sql)) return [[localPac({ api_url: `http://127.0.0.1:${port}` })]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ rfc: 'EKU9003173C9', razon_social: 'E', regimen_fiscal: '601', codigo_postal_fiscal: '42501' }]];
      if (/cfdi_cancellations/.test(sql)) return [{ insertId: 1 }];
      return [{ affectedRows: 1 }];
    });
    await expect(cfdiService.cancel(7, '02')).rejects.toThrow(/SW still signs cancellations with the CSD/);
    await new Promise(r => errServer.close(r));
  });

  test("seal_mode='pac' still uses the Emisión (issue) endpoint with plain-XML JSON", async () => {
    wireDb({ pac: localPac({ seal_mode: 'pac' }) });
    await cfdiService.stamp(7);
    expect(captured.url).toBe('/cfdi33/issue/json/v4');
    const parsed = JSON.parse(captured.body);
    expect(parsed.data).toContain('<cfdi:Comprobante');
    expect(parsed.data).not.toContain('Sello=');
  });
});
