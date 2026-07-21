// =============================================================================
// FireISP 5.0 — Representación impresa tests
// =============================================================================
// The parse/render fixtures are the two REAL SW-sealed sandbox documents
// (SAT-accepted), so the parser is exercised against genuine PAC output.
// =============================================================================

const fs = require('fs');
const path = require('path');
const repr = require('../src/services/cfdiRepresentacionPdf');

const FIX = path.join(__dirname, 'fixtures/csd');
const INVOICE_XML = fs.readFileSync(path.join(FIX, 'sw-sealed-invoice.xml'), 'utf8');
const REP_XML = fs.readFileSync(path.join(FIX, 'sw-sealed-rep.xml'), 'utf8');

describe('parseCfdiXml (real PAC-sealed documents)', () => {
  test('extracts the full invoice model incl. TFD', () => {
    const m = repr.parseCfdiXml(INVOICE_XML);
    expect(m.version).toBe('4.0');
    expect(m.tipo_comprobante).toBe('I');
    expect(m.emisor).toMatchObject({ rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', regimen: '601' });
    expect(m.receptor).toMatchObject({ rfc: 'MISC491214B86', cp: '01010', regimen: '612', uso_cfdi: 'G03' });
    expect(m.no_certificado).toBe('30001000000500003416');
    expect(m.sello_cfd).toBeTruthy();
    expect(m.conceptos).toHaveLength(1);
    expect(m.conceptos[0]).toMatchObject({ clave_prod_serv: '81161700', clave_unidad: 'E48' });
    expect(m.traslados[0]).toMatchObject({ impuesto: '002', tasa: '0.160000' });
    expect(m.tfd).toMatchObject({
      uuid: '60432946-1429-43b3-898c-051770dd7d3a',
      rfc_prov_certif: expect.any(String),
    });
    expect(m.tfd.sello_sat).toBeTruthy();
    expect(m.tfd.no_certificado_sat).toBeTruthy();
  });

  test('extracts the Pagos 2.0 model from a tipo-P REP', () => {
    const m = repr.parseCfdiXml(REP_XML);
    expect(m.tipo_comprobante).toBe('P');
    expect(m.pagos.pagos).toHaveLength(1);
    expect(m.pagos.pagos[0].doctos[0]).toMatchObject({
      id_documento: '60432946-1429-43b3-898c-051770dd7d3a',
      num_parcialidad: '1',
    });
    expect(m.pagos.monto_total_pagos).toBe('116.00');
  });
});

describe('fiscal strings', () => {
  test('tfdCadena has the Anexo 20 shape', () => {
    const m = repr.parseCfdiXml(INVOICE_XML);
    const cadena = repr.tfdCadena(m.tfd);
    expect(cadena.startsWith(`||1.1|${m.tfd.uuid}|${m.tfd.fecha_timbrado}|${m.tfd.rfc_prov_certif}|`)).toBe(true);
    expect(cadena.endsWith(`|${m.tfd.no_certificado_sat}||`)).toBe(true);
  });

  test('satVerificationUrl carries id/re/rr/tt and the last 8 of the SelloCFD', () => {
    const m = repr.parseCfdiXml(INVOICE_XML);
    const url = repr.satVerificationUrl(m);
    expect(url).toContain('https://verificacfdi.facturacion.sat.gob.mx/default.aspx?');
    expect(url).toContain(`id=${m.tfd.uuid}`);
    expect(url).toContain('re=EKU9003173C9');
    expect(url).toContain('rr=MISC491214B86');
    expect(url).toContain(`tt=${m.total}`);
    expect(url).toContain(`fe=${m.tfd.sello_cfd.slice(-8)}`);
  });
});

describe('totalConLetra', () => {
  const cases = [
    [116, 'CIENTO DIECISÉIS PESOS 00/100 M.N.'],
    [0.5, 'CERO PESOS 50/100 M.N.'],
    [1, 'UN PESOS 01/100 M.N.'.replace(' 01/', ' 00/')], // 1.00 → UN PESOS 00/100
    [21, 'VEINTIÚN PESOS 00/100 M.N.'],
    [100, 'CIEN PESOS 00/100 M.N.'],
    [580, 'QUINIENTOS OCHENTA PESOS 00/100 M.N.'],
    [1000, 'MIL PESOS 00/100 M.N.'],
    [1999.99, 'MIL NOVECIENTOS NOVENTA Y NUEVE PESOS 99/100 M.N.'],
    [1500000.75, 'UN MILLÓN QUINIENTOS MIL PESOS 75/100 M.N.'],
  ];
  test.each(cases)('%s → %s', (n, expected) => {
    expect(repr.totalConLetra(n)).toBe(expected);
  });

  test('USD gets DÓLARES without M.N.', () => {
    expect(repr.totalConLetra(20, 'USD')).toBe('VEINTE DÓLARES 00/100');
  });
});

describe('renderRepresentacionImpresa', () => {
  test('renders a PDF for a stamped invoice', async () => {
    const buf = await repr.renderRepresentacionImpresa({ xml: INVOICE_XML, satStatus: 'vigente' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000); // QR + seals present
  });

  test('renders a PDF for a tipo-P REP', async () => {
    const buf = await repr.renderRepresentacionImpresa({ xml: REP_XML, satStatus: 'vigente' });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  test('refuses XML without a TimbreFiscalDigital', async () => {
    const unstamped = INVOICE_XML.replace(/<cfdi:Complemento>[\s\S]*<\/cfdi:Complemento>/, '');
    await expect(repr.renderRepresentacionImpresa({ xml: unstamped }))
      .rejects.toThrow(/TimbreFiscalDigital/);
  });
});
