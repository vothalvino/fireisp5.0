// =============================================================================
// FireISP 5.0 — Complemento de Pago 2.0 Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------
const baseParams = {
  organization_id: 1,
  client_id: 2,
  payment_id: 42,
  serie: 'P',
  folio: '1',
  fecha_emision: '2026-01-15T12:00:00Z',
  lugar_expedicion: '64000',
  emisor_rfc: 'XAXX010101000',
  emisor_nombre: 'ISP SA de CV',
  emisor_regimen_fiscal: '601',
  receptor_rfc: 'XBXX020202001',
  receptor_nombre: 'Cliente Ejemplo',
  receptor_domicilio_fiscal: '64000',
  receptor_regimen_fiscal: '616',
  payment_date: '2026-01-15',
  forma_pago: '03',
  moneda: 'MXN',
  tipo_cambio: null,
  amount: 580.00,
  operation_number: 'TXN-001',
  payer_rfc: null,
  payer_bank_name: 'BBVA',
  payer_account: '012345678901234567',
  beneficiary_rfc: 'XAXX010101000',
  beneficiary_account: '098765432109876543',
  related_documents: [
    {
      related_cfdi_uuid: 'aaaabbbb-1111-2222-3333-ccccddddeeee',
      serie: 'A',
      folio: '100',
      moneda_dr: 'MXN',
      equivalencia_dr: 1.0,
      num_parcialidad: 1,
      imp_saldo_ant: 580.00,
      imp_pagado: 580.00,
      imp_saldo_insoluto: 0.00,
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock helper: simulate successful DB inserts
// ---------------------------------------------------------------------------
// SQL-dispatched (not an ordered once-queue): the tax-desglose enrichment adds
// a SELECT against the original CFDI per related document between the item
// inserts and the xml UPDATE, and ordered queues break every time a query is
// added. `original` controls what that SELECT sees (default: no original on
// file → ObjetoImpDR="01").
function mockSuccessfulInserts({ original = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/INSERT INTO cfdi_documents/.test(sql)) return [{ insertId: 10 }];
    if (/INSERT INTO cfdi_payment_complement_items/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO cfdi_payment_complements/.test(sql)) return [{ insertId: 20 }];
    if (/SELECT subtotal, total_impuestos, total FROM cfdi_documents/.test(sql)) {
      return [original ? [{ ...original }] : []];
    }
    return [{ affectedRows: 1 }]; // UPDATE xml_content
  });
}

// ===========================================================================
// buildPaymentComplementXml
// ===========================================================================
describe('buildPaymentComplementXml()', () => {
  const doc = {
    serie: 'P', folio: '1', fecha_emision: '2026-01-15T12:00:00Z',
    lugar_expedicion: '64000',
    emisor_rfc: 'XAXX010101000', emisor_nombre: 'ISP SA de CV', emisor_regimen_fiscal: '601',
    receptor_rfc: 'XBXX020202001', receptor_nombre: 'Cliente Ejemplo',
    receptor_domicilio_fiscal: '64000', receptor_regimen_fiscal: '616',
  };

  const complement = {
    payment_date: '2026-01-15',
    forma_pago: '03',
    moneda: 'MXN',
    tipo_cambio: null,
    amount: 580.00,
    operation_number: 'TXN-001',
    payer_rfc: null,
    payer_bank_name: 'BBVA',
    payer_account: '012345678901234567',
    beneficiary_rfc: 'XAXX010101000',
    beneficiary_account: '098765432109876543',
  };

  const items = [
    {
      related_cfdi_uuid: 'aaaabbbb-1111-2222-3333-ccccddddeeee',
      serie: 'A', folio: '100',
      moneda_dr: 'MXN', equivalencia_dr: 1.0,
      num_parcialidad: 1,
      imp_saldo_ant: 580.00, imp_pagado: 580.00, imp_saldo_insoluto: 0.00,
    },
  ];

  test('returns valid XML with correct root element and namespaces', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<cfdi:Comprobante');
    expect(xml).toContain('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"');
    expect(xml).toContain('xmlns:pago20="http://www.sat.gob.mx/Pagos20"');
  });

  test('sets TipoDeComprobante="P"', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('TipoDeComprobante="P"');
  });

  test('sets Moneda="XXX" (SAT rule for tipo P)', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('Moneda="XXX"');
  });

  test('sets SubTotal="0" and Total="0"', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('SubTotal="0"');
    expect(xml).toContain('Total="0"');
  });

  test('sets UsoCFDI="CP01" on Receptor', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('UsoCFDI="CP01"');
  });

  test('includes mandatory Concepto for pago (ClaveProdServ=84111506)', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('ClaveProdServ="84111506"');
    expect(xml).toContain('ClaveUnidad="ACT"');
    expect(xml).toContain('Descripcion="Pago"');
    expect(xml).toContain('ValorUnitario="0"');
    expect(xml).toContain('ObjetoImp="01"');
  });

  test('includes pago20:Pagos complemento with correct version', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('<pago20:Pagos Version="2.0">');
  });

  test('includes pago20:Totales with MontoTotalPagos', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('MontoTotalPagos="580.00"');
  });

  test('includes pago20:Pago with correct attributes', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('<pago20:Pago');
    expect(xml).toContain('FormaDePagoP="03"');
    expect(xml).toContain('MonedaP="MXN"');
    expect(xml).toContain('Monto="580.00"');
    expect(xml).toContain('NumOperacion="TXN-001"');
  });

  test('includes FechaPago with time component when only date provided', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('FechaPago="2026-01-15T12:00:00"');
  });

  test('preserves FechaPago datetime when full ISO string provided', () => {
    const complementWithDatetime = { ...complement, payment_date: '2026-01-15T09:30:00' };
    const xml = cfdiService.buildPaymentComplementXml(doc, complementWithDatetime, items);
    expect(xml).toContain('FechaPago="2026-01-15T09:30:00"');
  });

  test('includes DoctoRelacionado with all required attributes', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('<pago20:DoctoRelacionado');
    expect(xml).toContain('IdDocumento="aaaabbbb-1111-2222-3333-ccccddddeeee"');
    expect(xml).toContain('MonedaDR="MXN"');
    // CRP20238 (sandbox-verified): MonedaDR == MonedaP → literal "1"
    expect(xml).toContain('EquivalenciaDR="1"');
    expect(xml).not.toContain('EquivalenciaDR="1.0000"');
    expect(xml).toContain('NumParcialidad="1"');
    expect(xml).toContain('ImpSaldoAnt="580.00"');
    expect(xml).toContain('ImpPagado="580.00"');
    expect(xml).toContain('ImpSaldoInsoluto="0.00"');
    expect(xml).toContain('ObjetoImpDR="01"');
  });

  test('includes Serie and Folio on DoctoRelacionado when provided', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('Serie="A"');
    expect(xml).toContain('Folio="100"');
  });

  test('omits Serie/Folio on DoctoRelacionado when absent', () => {
    const itemsNoFolio = [{ ...items[0], serie: null, folio: null }];
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, itemsNoFolio);
    expect(xml).not.toContain('Serie=""');
    expect(xml).not.toContain('Folio=""');
  });

  test('includes optional payer bank attributes when provided', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('NomBancoOrdExt="BBVA"');
    expect(xml).toContain('CtaOrdenante="012345678901234567"');
    expect(xml).toContain('RfcEmisorCtaBen="XAXX010101000"');
    expect(xml).toContain('CtaBeneficiario="098765432109876543"');
  });

  test('omits optional payer attributes when null', () => {
    const minimalComplement = {
      payment_date: '2026-01-15', forma_pago: '03', moneda: 'MXN',
      tipo_cambio: null, amount: 580.00,
      operation_number: null, payer_rfc: null, payer_bank_name: null,
      payer_account: null, beneficiary_rfc: null, beneficiary_account: null,
    };
    const xml = cfdiService.buildPaymentComplementXml(doc, minimalComplement, items);
    expect(xml).not.toContain('NomBancoOrdExt');
    expect(xml).not.toContain('NumOperacion');
    expect(xml).not.toContain('CtaBeneficiario');
  });

  test('includes TipoCambioP when tipo_cambio is provided', () => {
    const complementForeign = { ...complement, moneda: 'USD', tipo_cambio: 17.25 };
    const xml = cfdiService.buildPaymentComplementXml(doc, complementForeign, items);
    expect(xml).toContain('TipoCambioP="17.25"');
  });

  test('MXN forces TipoCambioP="1" even when tipo_cambio is null (CRP20215)', () => {
    // Sandbox-verified: SW reads an ABSENT TipoCambioP as 0 and rejects the
    // REP — for MonedaP=MXN the attribute must be present as the literal "1".
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).toContain('TipoCambioP="1"');
  });

  test('handles multiple DoctoRelacionado items', () => {
    const twoItems = [
      { ...items[0], related_cfdi_uuid: 'uuid-0001', imp_pagado: 300.00, imp_saldo_insoluto: 280.00, imp_saldo_ant: 580.00 },
      { related_cfdi_uuid: 'uuid-0002', serie: 'B', folio: '200', moneda_dr: 'MXN', equivalencia_dr: 1.0, num_parcialidad: 2, imp_saldo_ant: 280.00, imp_pagado: 280.00, imp_saldo_insoluto: 0.00 },
    ];
    const xml = cfdiService.buildPaymentComplementXml(doc, { ...complement, amount: 580.00 }, twoItems);
    expect(xml).toContain('IdDocumento="uuid-0001"');
    expect(xml).toContain('IdDocumento="uuid-0002"');
    expect(xml).toContain('MontoTotalPagos="580.00"');
  });

  test('MontoTotalPagos sums imp_pagado across all items', () => {
    const twoItems = [
      { ...items[0], imp_pagado: 200.00, imp_saldo_insoluto: 380.00 },
      { ...items[0], related_cfdi_uuid: 'uuid-0002', imp_pagado: 380.00, imp_saldo_insoluto: 0.00 },
    ];
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, twoItems);
    expect(xml).toContain('MontoTotalPagos="580.00"');
  });

  test('escapes XML special characters in receptor nombre', () => {
    const docSpecial = { ...doc, receptor_nombre: 'Client & <Test>' };
    const xml = cfdiService.buildPaymentComplementXml(docSpecial, complement, items);
    expect(xml).toContain('Nombre="Client &amp; &lt;Test&gt;"');
  });

  test('handles empty doc fields gracefully', () => {
    const emptyDoc = {};
    const xml = cfdiService.buildPaymentComplementXml(emptyDoc, complement, items);
    expect(xml).toContain('TipoDeComprobante="P"');
    expect(xml).toContain('Moneda="XXX"');
  });
});

// ===========================================================================
// generatePaymentComplement
// ===========================================================================
describe('generatePaymentComplement()', () => {
  beforeEach(() => jest.resetAllMocks());

  test('creates cfdi_documents, complement, item and stores XML', async () => {
    mockSuccessfulInserts();

    const result = await cfdiService.generatePaymentComplement(baseParams);

    expect(result.cfdi_document_id).toBe(10);
    expect(result.complement_id).toBe(20);
    expect(result.xml).toContain('TipoDeComprobante="P"');
    expect(result.xml).toContain('Moneda="XXX"');
  });

  test('inserts cfdi_documents with tipo_comprobante=P and uso_cfdi=CP01', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement(baseParams);

    const insertDocCall = db.query.mock.calls[0];
    expect(insertDocCall[0]).toContain("'P'");
    expect(insertDocCall[0]).toContain("'CP01'");
  });

  test('inserts cfdi_documents with Moneda=XXX (SAT rule for tipo P)', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement(baseParams);

    const insertDocCall = db.query.mock.calls[0];
    expect(insertDocCall[0]).toContain("'XXX'");
  });

  test('inserts cfdi_payment_complements with payment metadata', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement(baseParams);

    const insertCompCall = db.query.mock.calls[1];
    expect(insertCompCall[0]).toContain('cfdi_payment_complements');
    // cfdiDocumentId=10, payment_date, forma_pago, moneda, tipo_cambio, amount ...
    expect(insertCompCall[1][0]).toBe(10); // cfdi_document_id
    expect(insertCompCall[1][1]).toBe('2026-01-15'); // payment_date
    expect(insertCompCall[1][2]).toBe('03'); // forma_pago
    expect(insertCompCall[1][3]).toBe('MXN'); // moneda
    expect(insertCompCall[1][5]).toBe(580.00); // amount
  });

  test('inserts one cfdi_payment_complement_items row per related document', async () => {
    mockSuccessfulInserts();

    const paramsTwo = {
      ...baseParams,
      related_documents: [
        { ...baseParams.related_documents[0] },
        { related_cfdi_uuid: 'bbbb-2222', serie: 'B', folio: '200', moneda_dr: 'MXN', equivalencia_dr: 1.0, num_parcialidad: 1, imp_saldo_ant: 200, imp_pagado: 200, imp_saldo_insoluto: 0 },
      ],
    };

    const result = await cfdiService.generatePaymentComplement(paramsTwo);

    const itemInserts = db.query.mock.calls.filter(c => /INSERT INTO cfdi_payment_complement_items/.test(c[0]));
    expect(itemInserts).toHaveLength(2);
    expect(result.cfdi_document_id).toBe(10);
  });

  test('stores generated XML in cfdi_documents', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement(baseParams);

    const updateCall = db.query.mock.calls.find(c => /UPDATE cfdi_documents SET xml_content/.test(c[0]));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toContain('TipoDeComprobante="P"');
    expect(updateCall[1][1]).toBe(10); // cfdi_document_id
  });

  test('throws when related_documents is empty', async () => {
    await expect(
      cfdiService.generatePaymentComplement({ ...baseParams, related_documents: [] }),
    ).rejects.toThrow('At least one related document');
  });

  test('throws when related_documents is missing', async () => {
    const { related_documents: _rd, ...noRd } = baseParams;
    await expect(
      cfdiService.generatePaymentComplement(noRd),
    ).rejects.toThrow('At least one related document');
  });

  test('handles partial payment (imp_saldo_insoluto > 0)', async () => {
    mockSuccessfulInserts();

    const partialParams = {
      ...baseParams,
      amount: 290.00,
      related_documents: [
        {
          ...baseParams.related_documents[0],
          imp_pagado: 290.00,
          imp_saldo_insoluto: 290.00,
          num_parcialidad: 1,
        },
      ],
    };

    const result = await cfdiService.generatePaymentComplement(partialParams);

    expect(result.xml).toContain('ImpPagado="290.00"');
    expect(result.xml).toContain('ImpSaldoInsoluto="290.00"');
  });

  test('links payment_id on the cfdi_documents row when provided', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement({ ...baseParams, payment_id: 99 });

    const insertDocCall = db.query.mock.calls[0];
    // payment_id is the last param in the values array
    const values = insertDocCall[1];
    expect(values[values.length - 1]).toBe(99);
  });

  test('uses null payment_id when not provided', async () => {
    mockSuccessfulInserts();

    const { payment_id: _p, ...noPaymentId } = baseParams;
    await cfdiService.generatePaymentComplement(noPaymentId);

    const insertDocCall = db.query.mock.calls[0];
    const values = insertDocCall[1];
    expect(values[values.length - 1]).toBeNull();
  });

  test('defaults equivalencia_dr to 1.0 when not provided', async () => {
    mockSuccessfulInserts();

    const paramsNoEq = {
      ...baseParams,
      related_documents: [
        { related_cfdi_uuid: 'uuid-x', moneda_dr: 'MXN', imp_saldo_ant: 100, imp_pagado: 100, imp_saldo_insoluto: 0 },
      ],
    };

    await cfdiService.generatePaymentComplement(paramsNoEq);

    const insertItemCall = db.query.mock.calls[2];
    // equivalencia_dr is the 6th param (index 5): complement_id, uuid, serie, folio, moneda_dr, equivalencia_dr
    expect(insertItemCall[1][5]).toBe(1.0);
  });
});

// ===========================================================================
// getPaymentComplement
// ===========================================================================
describe('getPaymentComplement()', () => {
  beforeEach(() => jest.resetAllMocks());

  test('returns document, complement and items', async () => {
    const mockDoc = { id: 10, tipo_comprobante: 'P', organization_id: 1 };
    const mockComplement = { id: 20, cfdi_document_id: 10, amount: 580.00 };
    const mockItems = [{ id: 1, complement_id: 20, related_cfdi_uuid: 'uuid-123' }];

    db.query
      .mockResolvedValueOnce([[mockDoc]])        // SELECT cfdi_documents
      .mockResolvedValueOnce([[mockComplement]]) // SELECT cfdi_payment_complements
      .mockResolvedValueOnce([mockItems]);       // SELECT cfdi_payment_complement_items

    const result = await cfdiService.getPaymentComplement(10, 1);

    expect(result.document).toEqual(mockDoc);
    expect(result.complement).toEqual(mockComplement);
    expect(result.items).toEqual(mockItems);
  });

  test('throws when cfdi_document not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // no document

    await expect(cfdiService.getPaymentComplement(999, 1))
      .rejects.toThrow('Payment complement document not found');
  });

  test('throws when complement record not found', async () => {
    const mockDoc = { id: 10, tipo_comprobante: 'P' };
    db.query
      .mockResolvedValueOnce([[mockDoc]]) // found document
      .mockResolvedValueOnce([[]]); // no complement

    await expect(cfdiService.getPaymentComplement(10, 1))
      .rejects.toThrow('Payment complement record not found');
  });

  test('queries only tipo_comprobante=P documents', async () => {
    db.query.mockResolvedValueOnce([[]]); // not found

    await cfdiService.getPaymentComplement(10, 1).catch(() => {});

    const selectCall = db.query.mock.calls[0];
    expect(selectCall[0]).toContain("tipo_comprobante = 'P'");
  });

  test('filters by organization_id for security', async () => {
    db.query.mockResolvedValueOnce([[]]); // not found

    await cfdiService.getPaymentComplement(10, 5).catch(() => {});

    const selectCall = db.query.mock.calls[0];
    expect(selectCall[1]).toContain(5); // orgId in params
  });
});

// ===========================================================================
// Pagos 2.0 — sandbox-verified shape (SW live probe, 2026-07-20)
// Every rule here was learned from a REAL PAC rejection (CO1003, CRP20215,
// CRP20238) or acceptance — do not relax without re-proving against a PAC.
// ===========================================================================
describe('buildPaymentComplementXml — sandbox-verified Pagos 2.0 shape', () => {
  const doc = {
    serie: 'P', folio: 7, fecha_emision: '2026-07-20T14:51:13',
    lugar_expedicion: '42501',
    emisor_rfc: 'EKU9003173C9', emisor_nombre: 'ESCUELA KEMPER URGATE', emisor_regimen_fiscal: '601',
    receptor_rfc: 'MISC491214B86', receptor_nombre: 'CECILIA MIRANDA SANCHEZ',
    receptor_domicilio_fiscal: '01010', receptor_regimen_fiscal: '612',
  };
  const complement = { payment_date: '2026-07-20', forma_pago: '03', moneda: 'MXN', amount: 116 };
  const ivaItem = {
    related_cfdi_uuid: '60432946-1429-43b3-898c-051770dd7d3a',
    serie: 'A', folio: 6, moneda_dr: 'MXN', equivalencia_dr: 1,
    num_parcialidad: 1, imp_saldo_ant: 116, imp_pagado: 116, imp_saldo_insoluto: 0,
    objeto_imp_dr: '02', traslado_dr: { base: 100, tasa: '0.160000', importe: 16 },
  };

  test('schemaLocation carries BOTH pairs — cfd/4 AND Pagos20 (CO1003)', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [ivaItem]);
    expect(xml).toContain(
      'xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd '
      + 'http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd"',
    );
  });

  test('ObjetoImpDR=02 renders ImpuestosDR, aggregated ImpuestosP AFTER doctos, and Totales IVA16 attrs', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [ivaItem]);
    expect(xml).toContain('ObjetoImpDR="02"');
    expect(xml).toContain('<pago20:TrasladoDR BaseDR="100.00" ImpuestoDR="002" TipoFactorDR="Tasa" TasaOCuotaDR="0.160000" ImporteDR="16.00" />');
    expect(xml).toContain('<pago20:TrasladoP BaseP="100.00" ImpuestoP="002" TipoFactorP="Tasa" TasaOCuotaP="0.160000" ImporteP="16.00" />');
    // XSD sequence: ImpuestosP comes after the DoctoRelacionado nodes
    expect(xml.indexOf('pago20:ImpuestosP')).toBeGreaterThan(xml.indexOf('pago20:DoctoRelacionado'));
    expect(xml).toContain('<pago20:Totales TotalTrasladosBaseIVA16="100.00" TotalTrasladosImpuestoIVA16="16.00" MontoTotalPagos="116.00" />');
  });

  test('ImpuestosP aggregates multiple doctos at the same rate', () => {
    const second = {
      ...ivaItem, related_cfdi_uuid: 'aaaa1111-2222-4333-8444-555566667777',
      imp_saldo_ant: 232, imp_pagado: 232, imp_saldo_insoluto: 0,
      traslado_dr: { base: 200, tasa: '0.160000', importe: 32 },
    };
    const xml = cfdiService.buildPaymentComplementXml(doc, { ...complement, amount: 348 }, [ivaItem, second]);
    expect(xml).toContain('BaseP="300.00"');
    expect(xml).toContain('ImporteP="48.00"');
    expect(xml).toContain('TotalTrasladosBaseIVA16="300.00" TotalTrasladosImpuestoIVA16="48.00"');
  });

  test('ObjetoImpDR=01 and 03 render self-closed doctos with no ImpuestosDR/ImpuestosP/Totales-IVA', () => {
    for (const objeto of ['01', '03']) {
      const item = { ...ivaItem, objeto_imp_dr: objeto, traslado_dr: undefined };
      const xml = cfdiService.buildPaymentComplementXml(doc, complement, [item]);
      expect(xml).toContain(`ObjetoImpDR="${objeto}"`);
      expect(xml).not.toContain('ImpuestosDR');
      expect(xml).not.toContain('ImpuestosP');
      expect(xml).not.toContain('TotalTrasladosBaseIVA16');
      expect(xml).toContain('MontoTotalPagos="116.00"');
    }
  });

  test('Comprobante-level Serie/Folio are omitted entirely when absent (empty attr = XSD violation)', () => {
    const xml = cfdiService.buildPaymentComplementXml({ ...doc, serie: null, folio: null }, complement, [ivaItem]);
    expect(xml).not.toContain('Serie=""');
    expect(xml).not.toContain('Folio=""');
  });

  test('a plain CDMX-local fecha_emision string passes through UNSHIFTED regardless of server TZ', () => {
    // The old new Date(...).toISOString() round-trip re-emitted the local
    // string as UTC — a future Fecha (SAT reject) on any non-UTC server.
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [ivaItem]);
    expect(xml).toContain('Fecha="2026-07-20T14:51:13"');
  });

  test('foreign currency keeps the provided TipoCambioP and decimal EquivalenciaDR', () => {
    const usd = { ...complement, moneda: 'USD', tipo_cambio: 17.25 };
    const xml = cfdiService.buildPaymentComplementXml(doc, usd, [{ ...ivaItem, moneda_dr: 'MXN', equivalencia_dr: 0.058 }]);
    expect(xml).toContain('TipoCambioP="17.25"');
    expect(xml).toContain('EquivalenciaDR="0.0580"');
  });
});

// ===========================================================================
// enrichRelatedDocumentsWithTaxes — derives the desglose from the original CFDI
// ===========================================================================
describe('enrichRelatedDocumentsWithTaxes()', () => {
  beforeEach(() => jest.resetAllMocks());

  const rd = {
    related_cfdi_uuid: '60432946-1429-43b3-898c-051770dd7d3a',
    num_parcialidad: 1, imp_saldo_ant: 116, imp_pagado: 116, imp_saldo_insoluto: 0,
  };

  test('IVA-16 original → ObjetoImpDR 02 with proportional base/importe', async () => {
    db.query.mockResolvedValue([[{ subtotal: '100.00', total_impuestos: '16.00', total: '116.00' }]]);
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([rd], 5);
    expect(out.objeto_imp_dr).toBe('02');
    expect(out.traslado_dr).toEqual({ base: 100, tasa: '0.160000', importe: 16 });
  });

  test('partial payment splits proportionally at the invoice rate', async () => {
    db.query.mockResolvedValue([[{ subtotal: '500.00', total_impuestos: '80.00', total: '580.00' }]]);
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([{ ...rd, imp_pagado: 300 }], 5);
    expect(out.traslado_dr.base).toBeCloseTo(258.62, 2); // 300 / 1.16
    expect(out.traslado_dr.importe).toBeCloseTo(41.38, 2);
  });

  test('untaxed original → ObjetoImpDR 01, no desglose', async () => {
    db.query.mockResolvedValue([[{ subtotal: '100.00', total_impuestos: '0.00', total: '100.00' }]]);
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([rd], 5);
    expect(out.objeto_imp_dr).toBe('01');
    expect(out.traslado_dr).toBeUndefined();
  });

  test('no original CFDI on file → ObjetoImpDR 01 (never invents a rate)', async () => {
    db.query.mockResolvedValue([[]]);
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([rd], 5);
    expect(out.objeto_imp_dr).toBe('01');
  });

  test('non-catalog effective rate → ObjetoImpDR 03 (sí objeto, sin desglose)', async () => {
    db.query.mockResolvedValue([[{ subtotal: '100.00', total_impuestos: '11.00', total: '111.00' }]]);
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([rd], 5);
    expect(out.objeto_imp_dr).toBe('03');
    expect(out.traslado_dr).toBeUndefined();
  });

  test('a caller that already set objeto_imp_dr wins — no DB lookup', async () => {
    const preset = { ...rd, objeto_imp_dr: '02', traslado_dr: { base: 1, tasa: '0.160000', importe: 0.16 } };
    const [out] = await cfdiService.enrichRelatedDocumentsWithTaxes([preset], 5);
    expect(out).toEqual(preset);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Review-panel fixes (adversarially confirmed findings)
// ===========================================================================
describe('buildPaymentComplementXml — hardening (review findings)', () => {
  const doc = {
    serie: 'P', folio: 7, fecha_emision: '2026-07-20T14:51:13', lugar_expedicion: '42501',
    emisor_rfc: 'EKU9003173C9', emisor_nombre: 'ESCUELA KEMPER URGATE', emisor_regimen_fiscal: '601',
    receptor_rfc: 'MISC491214B86', receptor_nombre: 'CECILIA MIRANDA SANCHEZ',
    receptor_domicilio_fiscal: '01010', receptor_regimen_fiscal: '612',
  };
  const complement = { payment_date: '2026-07-20', forma_pago: '03', moneda: 'MXN', amount: 116 };
  const item = {
    related_cfdi_uuid: '60432946-1429-43b3-898c-051770dd7d3a',
    moneda_dr: 'MXN', equivalencia_dr: 1, num_parcialidad: 1,
    imp_saldo_ant: 116, imp_pagado: 116, imp_saldo_insoluto: 0,
  };

  test('a crafted tasa string cannot inject XML — desglose fields are Number-coerced', () => {
    const evil = {
      ...item, objeto_imp_dr: '02',
      traslado_dr: { base: 100, tasa: '0.160000"/><cfdi:Evil x="y', importe: 16 },
    };
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [evil]);
    expect(xml).not.toContain('Evil');
    // unusable desglose → honest degrade to 03 (02 without ImpuestosDR = CRP reject)
    expect(xml).toContain('ObjetoImpDR="03"');
    expect(xml).not.toContain('ImpuestosDR');
  });

  test('a crafted objeto_imp_dr string is whitelisted to the catalog', () => {
    const evil = { ...item, objeto_imp_dr: '01" Extra="x' };
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [evil]);
    expect(xml).not.toContain('Extra=');
    expect(xml).toContain('ObjetoImpDR="01"');
  });

  test('numeric-but-string desglose values still render (coercion, not rejection)', () => {
    const stringy = {
      ...item, objeto_imp_dr: '02',
      traslado_dr: { base: '100', tasa: '0.16', importe: '16' },
    };
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, [stringy]);
    expect(xml).toContain('TasaOCuotaDR="0.160000"');
    expect(xml).toContain('BaseDR="100.00"');
  });

  test('Pago-level ImpuestosP/Totales convert MonedaDR amounts into MonedaP via EquivalenciaDR', () => {
    const usdPago = { ...complement, moneda: 'USD', tipo_cambio: 19.5, amount: 5.95 };
    const mxnDocto = {
      ...item, equivalencia_dr: 19.5, objeto_imp_dr: '02',
      traslado_dr: { base: 100, tasa: '0.160000', importe: 16 },
    };
    const xml = cfdiService.buildPaymentComplementXml(doc, usdPago, [mxnDocto]);
    // docto level stays in MonedaDR (MXN)
    expect(xml).toContain('BaseDR="100.00"');
    // Pago/Totales level is in MonedaP (USD): 100/19.5 = 5.13, 16/19.5 = 0.82
    expect(xml).toContain('BaseP="5.13"');
    expect(xml).toContain('ImporteP="0.82"');
    expect(xml).toContain('TotalTrasladosBaseIVA16="5.13"');
  });

  test('date-only and MySQL space-separated fecha_emision are normalized to the Fecha XSD shape', () => {
    const d1 = cfdiService.buildPaymentComplementXml({ ...doc, fecha_emision: '2026-07-20' }, complement, [item]);
    expect(d1).toContain('Fecha="2026-07-20T00:00:00"');
    const d2 = cfdiService.buildPaymentComplementXml({ ...doc, fecha_emision: '2026-07-20 14:51:13' }, complement, [item]);
    expect(d2).toContain('Fecha="2026-07-20T14:51:13"');
  });
});
