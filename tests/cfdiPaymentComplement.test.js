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
function mockSuccessfulInserts() {
  db.query
    .mockResolvedValueOnce([{ insertId: 10 }])   // INSERT cfdi_documents
    .mockResolvedValueOnce([{ insertId: 20 }])   // INSERT cfdi_payment_complements
    .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT cfdi_payment_complement_items
    .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE xml_content
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
    expect(xml).toContain('EquivalenciaDR="1.0000"');
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

  test('omits TipoCambioP when tipo_cambio is null', () => {
    const xml = cfdiService.buildPaymentComplementXml(doc, complement, items);
    expect(xml).not.toContain('TipoCambioP');
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
    db.query
      .mockResolvedValueOnce([{ insertId: 10 }])   // INSERT cfdi_documents
      .mockResolvedValueOnce([{ insertId: 20 }])   // INSERT cfdi_payment_complements
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT item 1
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT item 2
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE xml

    const paramsTwo = {
      ...baseParams,
      related_documents: [
        { ...baseParams.related_documents[0] },
        { related_cfdi_uuid: 'bbbb-2222', serie: 'B', folio: '200', moneda_dr: 'MXN', equivalencia_dr: 1.0, num_parcialidad: 1, imp_saldo_ant: 200, imp_pagado: 200, imp_saldo_insoluto: 0 },
      ],
    };

    const result = await cfdiService.generatePaymentComplement(paramsTwo);

    // 5 total DB calls: INSERT doc, INSERT complement, INSERT item×2, UPDATE xml
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(result.cfdi_document_id).toBe(10);
  });

  test('stores generated XML in cfdi_documents', async () => {
    mockSuccessfulInserts();

    await cfdiService.generatePaymentComplement(baseParams);

    const updateCall = db.query.mock.calls[3]; // 4th call: UPDATE
    expect(updateCall[0]).toContain('UPDATE cfdi_documents SET xml_content');
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
