// =============================================================================
// FireISP 5.0 — CSD sealing engine tests
// =============================================================================
// Uses SAT's PUBLIC test CSD (EKU9003173C9, see tests/fixtures/csd/README.md)
// and two REAL SW-sealed sandbox documents as PAC-compatibility pins: if our
// cadena-original engine ever drifts from what a real PAC computes, the
// cross-validation tests fail.
// =============================================================================

const fs = require('fs');
const path = require('path');
const seal = require('../src/services/cfdiSealService');

const FIX = path.join(__dirname, 'fixtures/csd');
const CER = fs.readFileSync(path.join(FIX, 'EKU9003173C9.cer'));
const KEY = fs.readFileSync(path.join(FIX, 'EKU9003173C9.key'));
const PASS = '12345678a';

// A minimal but complete CFDI 4.0 invoice as our builders emit it — includes
// an em-dash and accented characters on purpose: the sello must be computed
// over UTF-8 bytes (node-forge's default latin1 digest was a live bug).
const INVOICE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0"
  Serie="A"
  Folio="6"
  FormaPago="99"
  MetodoPago="PPD"
  Fecha="2026-07-20T14:43:52"
  TipoDeComprobante="I"
  Exportacion="01"
  LugarExpedicion="42501"
  Moneda="MXN"
  SubTotal="100.00"
  Total="116.00">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="MISC491214B86" Nombre="CECILIA MIRANDA SANCHEZ" DomicilioFiscalReceptor="01010" RegimenFiscalReceptor="612" UsoCFDI="G03" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="81161700" Cantidad="1.0000" ClaveUnidad="E48" Descripcion="Conexión rápida — señal óptima" ValorUnitario="100.0000" Importe="100.0000" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="100.0000" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.0000" />
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16.00">
    <cfdi:Traslados>
      <cfdi:Traslado Base="100.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16.00" />
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;

function loadCsd() {
  return seal.loadCredential(CER, KEY, PASS);
}

describe('loadCredential + certificateInfo', () => {
  test('parses the SAT test CSD (identity, 20-digit serial, validity, test-CA flag)', () => {
    const info = seal.certificateInfo(loadCsd());
    expect(info.rfc).toBe('EKU9003173C9');
    expect(info.legal_name).toContain('KEMPER');
    expect(info.certificate_number).toBe('30001000000500003416');
    expect(info.certificate_number).toHaveLength(20);
    expect(info.certificado_b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    // pinned, not compared to the wall clock — the fixture expires 2027-05-18
    // and a Date.now() comparison would turn CI red on that day for no code reason
    expect(info.valid_to.toISOString().slice(0, 10)).toBe('2027-05-18');
    expect(info.is_test_certificate).toBe(true); // issuer CN=AC UAT
  });

  test('the CSD handle is safe to log: no passphrase or key PEM in any serialization', () => {
    // Review-confirmed leak (fixed): the nodecfdi credential kept the
    // PLAINTEXT passphrase + key PEM as enumerable properties, so a natural
    // logger.info({ csd }) would have dumped them. The handle must carry only
    // public certificate info + an opaque KeyObject.
    const util = require('util');
    const csd = loadCsd();
    const dumps = JSON.stringify(csd) + util.inspect(csd, { depth: 20 });
    expect(dumps).not.toContain(PASS);
    expect(dumps).not.toContain('PRIVATE KEY');
  });

  test('422 CSD_INVALID on a wrong passphrase', () => {
    expect(() => seal.loadCredential(CER, KEY, 'wrong-pass'))
      .toThrow(expect.objectContaining({ statusCode: 422, code: 'CSD_INVALID' }));
  });
});

describe('cadenaOriginal (SAT official XSLT)', () => {
  test('produces the Anexo 20 pipe chain with an empty NoCertificado slot pre-seal', () => {
    const cadena = seal.cadenaOriginal(INVOICE_XML);
    expect(cadena.startsWith('||4.0|A|6|2026-07-20T14:43:52|99||100.00|MXN|116.00|I|01|PPD|42501|')).toBe(true);
    expect(cadena.endsWith('||')).toBe(true);
    expect(cadena).toContain('|EKU9003173C9|ESCUELA KEMPER URGATE|601|');
  });
});

describe('sealXml + verifySeal', () => {
  test('seals: injects NoCertificado/Certificado/Sello and the seal verifies', () => {
    const sealed = seal.sealXml(INVOICE_XML, loadCsd());
    expect(sealed.xml).toContain('NoCertificado="30001000000500003416"');
    expect(sealed.xml).toMatch(/Certificado="[A-Za-z0-9+/=]+"/);
    expect(sealed.xml).toMatch(/Sello="[A-Za-z0-9+/=]+"/);
    expect(sealed.cadena).toContain('|30001000000500003416|'); // slot now filled
    expect(seal.verifySeal(sealed.xml)).toBe(true);
  });

  test('multibyte characters survive: sello is over UTF-8 bytes (forge-latin1 regression pin)', () => {
    // The fixture description carries "ó", "á", "—", "ñ" — under the latin1
    // digest this verify fails.
    const sealed = seal.sealXml(INVOICE_XML, loadCsd());
    expect(sealed.cadena).toContain('Conexión rápida — señal óptima');
    expect(seal.verifySeal(sealed.xml)).toBe(true);
  });

  test('tampering any sealed field invalidates the seal', () => {
    const sealed = seal.sealXml(INVOICE_XML, loadCsd());
    expect(seal.verifySeal(sealed.xml.replace('Total="116.00"', 'Total="999.00"'))).toBe(false);
    expect(seal.verifySeal(sealed.xml.replace('EKU9003173C9', 'AAA010101AAA'))).toBe(false);
  });

  test('refuses to double-seal (CFDI_ALREADY_SEALED)', () => {
    const sealed = seal.sealXml(INVOICE_XML, loadCsd());
    expect(() => seal.sealXml(sealed.xml, loadCsd()))
      .toThrow(expect.objectContaining({ statusCode: 422, code: 'CFDI_ALREADY_SEALED' }));
  });

  test('refuses non-4.0 documents (CFDI_SEAL_UNSUPPORTED)', () => {
    expect(() => seal.sealXml('<cfdi:Comprobante Version="3.3"/>', loadCsd()))
      .toThrow(expect.objectContaining({ statusCode: 422, code: 'CFDI_SEAL_UNSUPPORTED' }));
  });

  test('verifySeal is false for unsealed XML', () => {
    expect(seal.verifySeal(INVOICE_XML)).toBe(false);
  });
});

describe('PAC compatibility cross-validation', () => {
  // Two documents sealed by SW Sapien's production-grade engine (sandbox) and
  // ACCEPTED BY SAT. If our cadena computation matches theirs, their sello
  // verifies against our engine. Covers both tipo I and tipo P (Pagos 2.0
  // complement templates of the XSLT).
  test("SW's real seal on a tipo-I invoice verifies against OUR cadena engine", () => {
    const xml = fs.readFileSync(path.join(FIX, 'sw-sealed-invoice.xml'), 'utf8');
    expect(seal.verifySeal(xml)).toBe(true);
  });

  test("SW's real seal on a tipo-P REP (Pagos 2.0) verifies against OUR cadena engine", () => {
    const xml = fs.readFileSync(path.join(FIX, 'sw-sealed-rep.xml'), 'utf8');
    expect(seal.verifySeal(xml)).toBe(true);
  });
});
