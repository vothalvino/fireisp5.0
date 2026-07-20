// =============================================================================
// FireISP 5.0 — CFDI Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

describe('cfdiService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Reset circuit breaker state
    cfdiService.circuitBreaker.failures = 0;
    cfdiService.circuitBreaker.lastFailure = 0;
  });

  // =========================================================================
  // escapeXml
  // =========================================================================
  describe('escapeXml()', () => {
    test('escapes ampersand', () => {
      expect(cfdiService.escapeXml('A & B')).toBe('A &amp; B');
    });

    test('escapes angle brackets', () => {
      expect(cfdiService.escapeXml('<tag>')).toBe('&lt;tag&gt;');
    });

    test('escapes quotes', () => {
      expect(cfdiService.escapeXml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &apos;world&apos;');
    });

    test('handles empty string', () => {
      expect(cfdiService.escapeXml('')).toBe('');
    });

    test('converts numbers to string', () => {
      expect(cfdiService.escapeXml(123)).toBe('123');
    });

    test('handles null/undefined by converting to string', () => {
      expect(cfdiService.escapeXml(null)).toBe('null');
      expect(cfdiService.escapeXml(undefined)).toBe('undefined');
    });

    test('escapes multiple special characters in one string', () => {
      expect(cfdiService.escapeXml('A & B < C > D "E" \'F\''))
        .toBe('A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;');
    });

    test('leaves plain text unchanged', () => {
      expect(cfdiService.escapeXml('No special chars here')).toBe('No special chars here');
    });
  });

  // =========================================================================
  // buildCfdi40Xml
  // =========================================================================
  // Emisor identity now comes from organization_mx_profiles (joined at
  // generateXml time), not per-document columns — buildCfdi40Xml takes it as
  // its second argument.
  const EMISOR = { rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' };

  describe('buildCfdi40Xml()', () => {
    test('builds valid CFDI 4.0 XML structure', () => {
      const doc = {
        serie: 'A', folio: '001',
        forma_pago: '01', metodo_pago: 'PUE', tipo_comprobante: 'I',
        exportacion: '01', moneda: 'MXN',
        subtotal: '500.00', total: '580.00',
        receptor_rfc: 'XBXX020202000', receptor_nombre: 'Client',
        receptor_cp: '64000', receptor_regimen: '616', uso_cfdi: 'G03',
      };

      const xml = cfdiService.buildCfdi40Xml(doc, EMISOR, [], []);
      expect(xml).toContain('Version="4.0"');
      expect(xml).toContain('Serie="A"');
      expect(xml).toContain('Folio="001"');
      expect(xml).toContain('Rfc="XAXX010101000"');
      expect(xml).toContain('RegimenFiscal="601"');
      expect(xml).toContain('LugarExpedicion="64000"');
      expect(xml).toContain('Rfc="XBXX020202000"');
      expect(xml).toContain('DomicilioFiscalReceptor="64000"');
      expect(xml).toContain('RegimenFiscalReceptor="616"');
      expect(xml).toContain('<cfdi:Conceptos>');
      // Fecha is the expedition moment, CFDI format (no ms/Z)
      expect(xml).toMatch(/Fecha="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"/);
    });

    test('includes concepto elements with taxes', () => {
      const doc = { serie: 'B', moneda: 'MXN', subtotal: '500', total: '580',
        receptor_rfc: 'Y', receptor_nombre: 'R' };
      const concepto = { id: 10, clave_prod_serv: '81161700', cantidad: 1,
        clave_unidad: 'E48', descripcion: 'Internet', valor_unitario: '500', importe: '500', objeto_imp: '02' };
      const impuesto = { cfdi_concepto_id: 10, tax_type: 'traslado', base: '500',
        impuesto: '002', tipo_factor: 'Tasa', tasa_o_cuota: '0.16', importe: '80' };

      const xml = cfdiService.buildCfdi40Xml(doc, EMISOR, [concepto], [impuesto]);
      expect(xml).toContain('<cfdi:Concepto');
      expect(xml).toContain('Descripcion="Internet"');
      expect(xml).toContain('<cfdi:Traslado');
      // Comprobante-level summary is emitted when any traslado exists
      expect(xml).toContain('TotalImpuestosTrasladados="80.00"');
    });

    test('handles concepto without taxes', () => {
      const doc = { serie: 'C', moneda: 'MXN', subtotal: '100', total: '100',
        receptor_rfc: 'Y', receptor_nombre: 'R' };
      const concepto = { id: 20, clave_prod_serv: '43231500', cantidad: 1,
        clave_unidad: 'E48', descripcion: 'Service', valor_unitario: '100', importe: '100', objeto_imp: '01' };

      const xml = cfdiService.buildCfdi40Xml(doc, EMISOR, [concepto], []);
      expect(xml).toContain('Descripcion="Service"');
      expect(xml).not.toContain('<cfdi:Traslado');
    });

    test('handles empty fields with defaults', () => {
      const doc = {};  // All fields undefined

      const xml = cfdiService.buildCfdi40Xml(doc, EMISOR, [], []);
      expect(xml).toContain('Version="4.0"');
      expect(xml).toContain('TipoDeComprobante="I"');  // default
      expect(xml).toContain('Moneda="MXN"');  // default
    });

    test('escapes special XML characters in doc fields', () => {
      const doc = { serie: 'A&B', folio: '<1>',
        receptor_rfc: 'R', receptor_nombre: 'R' };
      const emisorQuoted = { ...EMISOR, razon_social: 'Corp "Test"' };

      const xml = cfdiService.buildCfdi40Xml(doc, emisorQuoted, [], []);
      expect(xml).toContain('Serie="A&amp;B"');
      expect(xml).toContain('Folio="&lt;1&gt;"');
      expect(xml).toContain('Nombre="Corp &quot;Test&quot;"');
    });
  });

  // =========================================================================
  // generateXml
  // =========================================================================
  describe('generateXml()', () => {
    test('generates CFDI 4.0 XML for a valid document', async () => {
      const doc = {
        id: 1, organization_id: 42, serie: 'A', folio: '001',
        forma_pago: '01', metodo_pago: 'PUE', tipo_comprobante: 'I',
        exportacion: '01', moneda: 'MXN',
        subtotal: '500.00', total: '580.00',
        receptor_rfc: 'XBXX020202000', receptor_nombre: 'Client',
        receptor_cp: '64000', receptor_regimen: '616', uso_cfdi: 'G03',
      };
      const concepto = {
        id: 10, clave_prod_serv: '81161700', no_identificacion: 'SVC01',
        cantidad: 1, clave_unidad: 'E48', descripcion: 'Internet 50Mbps',
        valor_unitario: '500.00', importe: '500.00', objeto_imp: '02',
      };
      const impuesto = {
        cfdi_concepto_id: 10, tax_type: 'traslado', base: '500.00',
        impuesto: '002', tipo_factor: 'Tasa', tasa_o_cuota: '0.160000',
        importe: '80.00',
      };

      db.query
        .mockResolvedValueOnce([[doc]])          // SELECT cfdi_documents
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' }]]) // org mx profile (emisor)
        .mockResolvedValueOnce([[concepto]])      // SELECT cfdi_conceptos
        .mockResolvedValueOnce([[impuesto]])      // SELECT cfdi_concepto_impuestos
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE xml_content

      const result = await cfdiService.generateXml(1);
      expect(result.cfdi_document_id).toBe(1);
      expect(result.xml).toContain('Version="4.0"');
      expect(result.xml).toContain('Internet 50Mbps');
      expect(result.xml).toContain('<cfdi:Traslado');
    });

    test('throws when document not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(cfdiService.generateXml(999)).rejects.toThrow('CFDI document not found');
    });

    test('422s (ORG_MX_PROFILE_MISSING) when the org has no complete fiscal profile', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 5, organization_id: 42 }]]) // doc exists
        .mockResolvedValueOnce([[]]);                              // no org mx profile
      await expect(cfdiService.generateXml(5))
        .rejects.toMatchObject({ statusCode: 422, code: 'ORG_MX_PROFILE_MISSING' });
    });

    test('422s when the fiscal profile exists but is incomplete (blank régimen)', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 6, organization_id: 42 }]])
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: null, codigo_postal_fiscal: '64000' }]]);
      await expect(cfdiService.generateXml(6))
        .rejects.toMatchObject({ statusCode: 422, code: 'ORG_MX_PROFILE_MISSING' });
    });

    test('generates XML with no conceptos', async () => {
      const doc = {
        id: 2, organization_id: 42, serie: 'B', folio: '002', moneda: 'MXN', subtotal: '0', total: '0',
        receptor_rfc: 'Y', receptor_nombre: 'R',
      };
      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' }]]) // org mx profile (emisor)
        .mockResolvedValueOnce([[]])     // no conceptos
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await cfdiService.generateXml(2);
      expect(result.xml).toContain('<cfdi:Conceptos>');
    });

    test('stores generated XML in database with draft status', async () => {
      const doc = { id: 3, organization_id: 42, serie: 'C', moneda: 'MXN', subtotal: '100', total: '100',
        receptor_rfc: 'Y', receptor_nombre: 'R' };

      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' }]]) // org mx profile (emisor)
        .mockResolvedValueOnce([[]])     // no conceptos
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

      await cfdiService.generateXml(3);

      const updateCall = db.query.mock.calls[3];
      expect(updateCall[0]).toContain('UPDATE cfdi_documents SET xml_content');
      expect(updateCall[1][1]).toBe('draft');  // sat_status = draft
      expect(updateCall[1][2]).toBe(3);        // cfdiDocumentId
    });

    test('generates XML with multiple conceptos', async () => {
      const doc = { id: 4, organization_id: 42, serie: 'D', moneda: 'MXN', subtotal: '800', total: '928',
        receptor_rfc: 'Y', receptor_nombre: 'R' };
      const c1 = { id: 10, clave_prod_serv: '81161700', cantidad: 1, clave_unidad: 'E48',
        descripcion: 'Internet', valor_unitario: '500', importe: '500', objeto_imp: '02' };
      const c2 = { id: 11, clave_prod_serv: '43231500', cantidad: 1, clave_unidad: 'E48',
        descripcion: 'Installation', valor_unitario: '300', importe: '300', objeto_imp: '02' };
      const tax1 = { cfdi_concepto_id: 10, tax_type: 'traslado', base: '500', impuesto: '002',
        tipo_factor: 'Tasa', tasa_o_cuota: '0.16', importe: '80' };
      const tax2 = { cfdi_concepto_id: 11, tax_type: 'traslado', base: '300', impuesto: '002',
        tipo_factor: 'Tasa', tasa_o_cuota: '0.16', importe: '48' };

      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' }]]) // org mx profile (emisor)
        .mockResolvedValueOnce([[c1, c2]])
        .mockResolvedValueOnce([[tax1, tax2]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await cfdiService.generateXml(4);
      expect(result.xml).toContain('Internet');
      expect(result.xml).toContain('Installation');
      // Comprobante-level summary sums both traslados (80 + 48)
      expect(result.xml).toContain('TotalImpuestosTrasladados="128.00"');
      // Two Concepto elements
      const conceptoMatches = result.xml.match(/<cfdi:Concepto /g);
      expect(conceptoMatches).toHaveLength(2);
    });
  });

  // =========================================================================
  // stamp
  // =========================================================================
  describe('stamp()', () => {
    test('stamps a document with generated UUID', async () => {
      const doc = { id: 1, organization_id: 42, xml_content: '<cfdi>...</cfdi>' };
      const pac = { id: 1, provider_name: 'dev_placeholder', status: 'active', environment: 'sandbox' };

      db.query
        .mockResolvedValueOnce([[doc]])   // SELECT document
        .mockResolvedValueOnce([[pac]])   // SELECT pac_providers
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE uuid

      const result = await cfdiService.stamp(1);
      expect(result.status).toBe('vigente');
      expect(result.uuid).toBeDefined();
      expect(result.cfdi_document_id).toBe(1);
    });

    test('throws when document not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(cfdiService.stamp(999)).rejects.toThrow('CFDI document not found');
    });

    test('throws when XML not generated', async () => {
      const doc = { id: 1, organization_id: 42, xml_content: null };
      db.query.mockResolvedValueOnce([[doc]]);
      await expect(cfdiService.stamp(1)).rejects.toThrow('XML not generated yet');
    });

    test('throws when no active PAC provider', async () => {
      const doc = { id: 1, organization_id: 42, xml_content: '<cfdi/>' };
      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([[]]);
      await expect(cfdiService.stamp(1)).rejects.toThrow('No active PAC provider');
    });

    test('surfaces the PAC error instead of writing an invalid sat_status', async () => {
      // cfdi_documents.sat_status is ENUM('draft','vigente','cancelado',
      // 'cancel_pending') — 'stamp_error' is NOT a value. The UPDATE that used to
      // run here therefore threw and MASKED the real PAC failure with a DB error.
      // A document that failed to stamp simply stays 'draft'.
      const doc = { id: 1, organization_id: 42, xml_content: '<cfdi/>' };
      const pac = { id: 1, provider_name: 'finkok', status: 'active', environment: 'sandbox' };

      db.query
        .mockResolvedValueOnce([[doc]])   // SELECT document
        .mockResolvedValueOnce([[pac]]);  // SELECT pac_providers

      // callPacStamp → httpRequest fails (no network); exercises the retry path.
      await expect(cfdiService.stamp(1)).rejects.toThrow(/PAC stamping failed/);

      const sqlIssued = db.query.mock.calls.map(([sql]) => sql).join('\n');
      expect(sqlIssued).not.toContain('stamp_error');
      const wroteSatStatus = db.query.mock.calls.some(
        ([sql, params]) => /UPDATE cfdi_documents/i.test(sql)
          && Array.isArray(params) && params.includes('stamp_error'),
      );
      expect(wroteSatStatus).toBe(false);
    }, 30000);

    test('rejects when circuit breaker is open', async () => {
      // Open the circuit breaker
      for (let i = 0; i < cfdiService.circuitBreaker.threshold; i++) {
        cfdiService.circuitBreaker.recordFailure();
      }

      await expect(cfdiService.stamp(1)).rejects.toThrow('circuit breaker is open');
    });
  });

  // =========================================================================
  // callPacStamp
  // =========================================================================
  describe('callPacStamp()', () => {
    test('uses placeholder UUID for unknown provider in non-production', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const pac = { provider_name: 'unknown_pac', environment: 'sandbox' };
      const promise = cfdiService.callPacStamp(pac, '<cfdi/>');

      return promise.then(result => {
        expect(result.uuid).toBeDefined();
        expect(result.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/); // UUID format
        expect(result.signedXml).toBeNull();
        process.env.NODE_ENV = origEnv;
      });
    });

    test('throws for unknown provider in production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const pac = { provider_name: 'unknown_pac', environment: 'production' };

      await expect(cfdiService.callPacStamp(pac, '<cfdi/>'))
        .rejects.toThrow('not a supported stamping service');

      process.env.NODE_ENV = origEnv;
    });
  });

  // =========================================================================
  // cancel
  // =========================================================================
  describe('cancel()', () => {
    const vigentDoc = {
      id: 1, organization_id: 42, sat_status: 'vigente',
      uuid: 'TEST-UUID-001', emisor_rfc: 'XAXX010101000',
    };
    const activePac = {
      id: 10, provider_name: 'dev_placeholder', status: 'active',
      environment: 'sandbox',
    };

    test('cancels a vigente document', async () => {
      db.query
        .mockResolvedValueOnce([[vigentDoc]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 1 }])   // INSERT cancellation
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE → cancel_pending
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE cancellation with PAC response
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE → cancelado

      const result = await cfdiService.cancel(1, '02');
      expect(result.status).toBe('cancelado');
      expect(result.reason).toBe('02');
    });

    test('throws when document not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(cfdiService.cancel(999, '01', 'REPLACE')).rejects.toThrow('CFDI document not found');
    });

    test('throws when document is not vigente', async () => {
      const doc = { id: 1, sat_status: 'cancelado', uuid: 'UUID' };
      db.query.mockResolvedValueOnce([[doc]]);
      await expect(cfdiService.cancel(1, '01', 'REPLACE')).rejects.toThrow('Can only cancel vigente documents');
    });

    test('passes replacement UUID for reason 01', async () => {
      db.query
        .mockResolvedValueOnce([[vigentDoc]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await cfdiService.cancel(1, '01', 'REPLACE-UUID-123');

      const insertCall = db.query.mock.calls[3];
      expect(insertCall[1]).toContain('REPLACE-UUID-123');
    });

    test('stores cancellation with null replacement when not provided', async () => {
      db.query
        .mockResolvedValueOnce([[vigentDoc]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 3 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await cfdiService.cancel(1, '02');

      const insertCall = db.query.mock.calls[3];
      expect(insertCall[1]).toContain(null); // replacementUuid default
    });

    test('returns correct cfdi_document_id in result', async () => {
      const doc77 = { ...vigentDoc, id: 77 };
      db.query
        .mockResolvedValueOnce([[doc77]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 4 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await cfdiService.cancel(77, '03');
      expect(result.cfdi_document_id).toBe(77);
    });

    test('throws for draft documents', async () => {
      const doc = { id: 1, sat_status: 'draft', uuid: 'UUID' };
      db.query.mockResolvedValueOnce([[doc]]);
      await expect(cfdiService.cancel(1, '02')).rejects.toThrow('Can only cancel vigente documents');
    });

    test('throws for stamp_error documents', async () => {
      const doc = { id: 1, sat_status: 'stamp_error', uuid: 'UUID' };
      db.query.mockResolvedValueOnce([[doc]]);
      await expect(cfdiService.cancel(1, '02')).rejects.toThrow('Can only cancel vigente documents');
    });
  });

  // =========================================================================
  // httpRequest
  // =========================================================================
  describe('httpRequest()', () => {
    test('is exported and callable', () => {
      expect(typeof cfdiService.httpRequest).toBe('function');
    });
  });

  // =========================================================================
  // Circuit Breaker state
  // =========================================================================
  describe('circuitBreaker state', () => {
    test('starts with 0 failures', () => {
      expect(cfdiService.circuitBreaker.failures).toBe(0);
    });

    test('isOpen returns false initially', () => {
      expect(cfdiService.circuitBreaker.isOpen()).toBe(false);
    });

    test('recordFailure increments failure count', () => {
      cfdiService.circuitBreaker.recordFailure();
      expect(cfdiService.circuitBreaker.failures).toBe(1);
    });

    test('recordSuccess resets failure count', () => {
      cfdiService.circuitBreaker.recordFailure();
      cfdiService.circuitBreaker.recordFailure();
      cfdiService.circuitBreaker.recordSuccess();
      expect(cfdiService.circuitBreaker.failures).toBe(0);
    });
  });
});
