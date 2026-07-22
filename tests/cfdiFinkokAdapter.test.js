// =============================================================================
// FireISP 5.0 — Finkok SOAP adapter (Phase 4)
// =============================================================================
// Contract taken verbatim from the demo Finkok WSDLs (stamp.wsdl / cancel.wsdl).
// Finkok stamps PRE-SEALED XML and signs cancellations with the CSD cer/key
// inline (local cancel-signing). A stand-in SOAP server captures the request
// and returns canned Finkok-shaped responses; the real seal engine runs.
// =============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));

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
  Version="4.0" Serie="A" Folio="9" Fecha="2026-07-21T10:00:00" TipoDeComprobante="I" Exportacion="01"
  LugarExpedicion="42501" Moneda="MXN" SubTotal="100.00" Total="116.00" FormaPago="99" MetodoPago="PPD">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="MISC491214B86" Nombre="CECILIA MIRANDA SANCHEZ" DomicilioFiscalReceptor="01010" RegimenFiscalReceptor="612" UsoCFDI="G03" />
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="81161700" Cantidad="1.0000" ClaveUnidad="E48" Descripcion="Internet" ValorUnitario="100.0000" Importe="100.0000" ObjetoImp="02">
    <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="100.0000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.0000" /></cfdi:Traslados></cfdi:Impuestos></cfdi:Concepto></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16.00"><cfdi:Traslados><cfdi:Traslado Base="100.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.00" /></cfdi:Traslados></cfdi:Impuestos>
</cfdi:Comprobante>`;

const CSD_ROW = {
  id: 1, organization_id: 5, rfc: 'EKU9003173C9',
  cer_pem: MATERIAL.cer_pem, key_pem_encrypted: MATERIAL.key_pem, passphrase_encrypted: '12345678a',
  is_active: 1, status: 'active', valid_to: new Date(Date.now() + 200 * 86400000),
};
const EMISOR = { rfc: 'EKU9003173C9', razon_social: 'ESCUELA KEMPER URGATE', regimen_fiscal: '601', codigo_postal_fiscal: '42501' };

let server; let captured; let respond;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      captured = { url: req.url, soapAction: req.headers.soapaction, body: b };
      res.setHeader('Content-Type', 'text/xml');
      res.end(respond(b));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
});
afterAll(async () => { await new Promise(r => server.close(r)); });

function base() { return `http://127.0.0.1:${server.address().port}`; }
function finkokPac(over = {}) {
  return {
    id: 3, provider_name: 'finkok', environment: 'sandbox', seal_mode: 'local',
    api_url: base(), username_encrypted: 'user@x.com', password_encrypted: 'pw', status: 'active', ...over,
  };
}

beforeEach(() => { jest.clearAllMocks(); captured = null; });

describe('Finkok stamp (SOAP, pre-sealed)', () => {
  beforeEach(() => {
    respond = () => `<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>`
      + `<stampResponse><stampResult>`
      + `<UUID>fedcba98-7654-4321-8000-abcdefabcdef</UUID>`
      + `<xml>&lt;cfdi:Comprobante&gt;&lt;tfd:TimbreFiscalDigital/&gt;&lt;/cfdi:Comprobante&gt;</xml>`
      + `<SatSeal>SAT_SEAL_B64</SatSeal><CodEstatus>Comprobante timbrado satisfactoriamente</CodEstatus>`
      + `</stampResult></stampResponse></senv:Body></senv:Envelope>`;
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ id: 9, organization_id: 5, xml_content: UNSEALED_XML, sat_status: 'draft', invoice_id: null }]];
      if (/FROM pac_providers/.test(sql)) return [[finkokPac()]];
      if (/FROM csd_certificates/.test(sql)) return [[{ ...CSD_ROW }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ ...EMISOR }]];
      return [{ affectedRows: 1 }];
    });
    require('../src/services/cfdiService').getEmisorProfile = undefined; // ensure real path
  });

  test('seals locally and posts base64 pre-sealed XML to /stamp with SOAPAction stamp', async () => {
    const res = await cfdiService.stamp(9);
    expect(res).toMatchObject({ uuid: 'fedcba98-7654-4321-8000-abcdefabcdef', status: 'vigente' });
    expect(captured.url).toBe('/stamp');
    expect(captured.soapAction).toBe('stamp');
    expect(captured.body).toContain('<fin:stamp>');
    // the xml field is base64 of a SEALED comprobante (our NoCertificado/Sello)
    const b64 = captured.body.match(/<fin:xml>([^<]+)<\/fin:xml>/)[1];
    const sent = Buffer.from(b64, 'base64').toString('utf8');
    expect(sent).toContain('NoCertificado="30001000000500003416"');
    expect(cfdiSealService.verifySeal(sent)).toBe(true);
    expect(captured.body).toContain('<fin:username>user@x.com</fin:username>');
  });

  test('surfaces a Finkok incidencia when no UUID comes back', async () => {
    respond = () => `<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>`
      + `<stampResponse><stampResult><Incidencias><Incidencia>`
      + `<CodigoError>307</CodigoError><MensajeIncidencia>Comprobante existente</MensajeIncidencia>`
      + `</Incidencia></Incidencias></stampResult></stampResponse></senv:Body></senv:Envelope>`;
    await expect(cfdiService.stamp(9)).rejects.toThrow(/PAC stamping failed.*Comprobante existente/s);
  });
});

describe('Finkok cancel (SOAP, locally-signed with the CSD)', () => {
  beforeEach(() => {
    respond = () => `<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>`
      + `<cancelResponse><cancelResult><Folios><Folio>`
      + `<UUID>fedcba98-7654-4321-8000-abcdefabcdef</UUID><EstatusUUID>201</EstatusUUID>`
      + `<EstatusCancelacion>Cancelado sin aceptación</EstatusCancelacion></Folio></Folios>`
      + `<Acuse>&lt;Acuse/&gt;</Acuse><Fecha>2026-07-21T10:05:00</Fecha></cancelResult></cancelResponse>`
      + `</senv:Body></senv:Envelope>`;
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ id: 9, organization_id: 5, uuid: 'fedcba98-7654-4321-8000-abcdefabcdef', sat_status: 'vigente', invoice_id: null, serie: 'A', folio: 9, total: '116.00' }]];
      if (/FROM pac_providers/.test(sql)) return [[finkokPac()]];
      if (/FROM csd_certificates/.test(sql)) return [[{ ...CSD_ROW }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ ...EMISOR }]];
      if (/cfdi_cancellations/.test(sql)) return [{ insertId: 1 }];
      return [{ affectedRows: 1 }];
    });
  });

  test('posts the CSD cer/key inline and the UUID+Motivo, maps EstatusUUID 201 → cancelled', async () => {
    const result = await cfdiService.cancel(9, '02');
    expect(captured.url).toBe('/cancel');
    expect(captured.soapAction).toBe('cancel');
    // The UUID element is <apps:UUID> in the apps.services.soap.core.views
    // namespace (Finkok's own cancel example), self-closing — live-verified
    // format (EstatusUUID 201). The envelope must declare that namespace.
    expect(captured.body).toContain('xmlns:apps="apps.services.soap.core.views"');
    expect(captured.body).toContain('<apps:UUID UUID="fedcba98-7654-4321-8000-abcdefabcdef" Motivo="02"/>');
    // cer/key are base64(PEM): certificate PEM + DECRYPTED (unencrypted PKCS#8)
    // key PEM — the exact pairing Finkok's demo accepts (DER or an encrypted key
    // both fail). Decode and assert the PEM headers, not just base64-ness.
    const cerB64 = captured.body.match(/<fin:cer>([^<]+)<\/fin:cer>/)[1];
    const keyB64 = captured.body.match(/<fin:key>([^<]+)<\/fin:key>/)[1];
    expect(Buffer.from(cerB64, 'base64').toString('utf8')).toContain('-----BEGIN CERTIFICATE-----');
    const keyPem = Buffer.from(keyB64, 'base64').toString('utf8');
    expect(keyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(keyPem).not.toContain('ENCRYPTED'); // must be the decrypted key
    expect(captured.body).toContain('<fin:taxpayer_id>EKU9003173C9</fin:taxpayer_id>');
    expect(result).toMatchObject({ status: 'cancelado' });
  });
});

describe('Finkok cancel — error handling (review findings)', () => {
  beforeEach(() => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ id: 9, organization_id: 5, uuid: 'fedcba98-7654-4321-8000-abcdefabcdef', sat_status: 'vigente', invoice_id: null, serie: 'A', folio: 9, total: '116.00', receptor_rfc: 'MISC491214B86' }]];
      if (/FROM pac_providers/.test(sql)) return [[finkokPac()]];
      if (/FROM csd_certificates/.test(sql)) return [[{ ...CSD_ROW }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ ...EMISOR }]];
      if (/cfdi_cancellations/.test(sql)) return [{ insertId: 1 }];
      return [{ affectedRows: 1 }];
    });
  });

  test('a SOAP fault on cancel is thrown, not swallowed as pending', async () => {
    respond = () => '<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>'
      + '<senv:Fault><faultstring>Authentication failed</faultstring></senv:Fault></senv:Body></senv:Envelope>';
    await expect(cfdiService.cancel(9, '02')).rejects.toThrow(/Authentication failed/);
  });

  test('a global error (no EstatusUUID) on cancel is thrown with the incidencia', async () => {
    respond = () => '<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>'
      + '<cancelResponse><cancelResult><CodEstatus>708 - El emisor no tiene certificado registrado</CodEstatus></cancelResult></cancelResponse>'
      + '</senv:Body></senv:Envelope>';
    await expect(cfdiService.cancel(9, '02')).rejects.toThrow(/708|certificado/);
  });
});

describe('Finkok get_sat_status (cancel-status poll)', () => {
  beforeEach(() => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM cfdi_documents WHERE uuid/.test(sql)) return [[{ organization_id: 5, receptor_rfc: 'MISC491214B86', total: '116.00' }]];
      if (/FROM organization_mx_profiles/.test(sql)) return [[{ ...EMISOR }]];
      return [{ affectedRows: 1 }];
    });
  });

  test('sends emisor RFC, receptor RFC, uuid and total', async () => {
    respond = () => '<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>'
      + '<get_sat_statusResponse><get_sat_statusResult><sat><Estado>Vigente</Estado><EstatusCancelacion>En proceso</EstatusCancelacion></sat></get_sat_statusResult></get_sat_statusResponse>'
      + '</senv:Body></senv:Envelope>';
    const r = await cfdiService.callPacCancelStatus(finkokPac(), 'fedcba98-7654-4321-8000-abcdefabcdef', {});
    expect(r.status).toBe('pending');
    expect(captured.body).toContain('<fin:taxpayer_id>EKU9003173C9</fin:taxpayer_id>');
    expect(captured.body).toContain('<fin:rtaxpayer_id>MISC491214B86</fin:rtaxpayer_id>');
    expect(captured.body).toContain('<fin:total>116.00</fin:total>');
  });

  test('maps a SAT-rejected cancellation to rejected (so the doc can revert to vigente)', async () => {
    respond = () => '<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>'
      + '<get_sat_statusResponse><get_sat_statusResult><sat><Estado>Vigente</Estado><EstatusCancelacion>Solicitud rechazada</EstatusCancelacion></sat></get_sat_statusResult></get_sat_statusResponse>'
      + '</senv:Body></senv:Envelope>';
    const r = await cfdiService.callPacCancelStatus(finkokPac(), 'fedcba98-7654-4321-8000-abcdefabcdef', {});
    expect(r.status).toBe('rejected');
  });

  test('maps Estado Cancelado to accepted', async () => {
    respond = () => '<senv:Envelope xmlns:senv="http://schemas.xmlsoap.org/soap/envelope/"><senv:Body>'
      + '<get_sat_statusResponse><get_sat_statusResult><sat><Estado>Cancelado</Estado></sat></get_sat_statusResult></get_sat_statusResponse>'
      + '</senv:Body></senv:Envelope>';
    const r = await cfdiService.callPacCancelStatus(finkokPac(), 'fedcba98-7654-4321-8000-abcdefabcdef', {});
    expect(r.status).toBe('accepted');
  });
});
