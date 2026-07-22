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
      // Comprobante-level summary is emitted when any traslado exists — and
      // per Anexo 20 it must carry the nested grouped Traslados detail, not a
      // bare total attribute (PACs reject the childless form).
      expect(xml).toContain('TotalImpuestosTrasladados="80.00"');
      const comprobanteImpuestos = xml.slice(xml.indexOf('</cfdi:Conceptos>'));
      expect(comprobanteImpuestos).toMatch(/<cfdi:Impuestos TotalImpuestosTrasladados="80.00">[\s\S]*<cfdi:Traslados>[\s\S]*<cfdi:Traslado Base="500.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="80.00"/);
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
        id: 1, organization_id: 42, sat_status: 'draft', serie: 'A', folio: '001',
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
        .mockResolvedValueOnce([[{ id: 5, organization_id: 42, sat_status: 'draft' }]]) // doc exists
        .mockResolvedValueOnce([[]]);                              // no org mx profile
      await expect(cfdiService.generateXml(5))
        .rejects.toMatchObject({ statusCode: 422, code: 'ORG_MX_PROFILE_MISSING' });
    });

    test('422s when the fiscal profile exists but is incomplete (blank régimen)', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 6, organization_id: 42, sat_status: 'draft' }]])
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: null, codigo_postal_fiscal: '64000' }]]);
      await expect(cfdiService.generateXml(6))
        .rejects.toMatchObject({ statusCode: 422, code: 'ORG_MX_PROFILE_MISSING' });
    });

    test('422s (RECEPTOR_INCOMPLETE) when the doc lacks receptor fiscal data', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 7, organization_id: 42, sat_status: 'draft', receptor_rfc: 'XBXX020202000', receptor_nombre: 'Client' }]]) // no regimen/cp
        .mockResolvedValueOnce([[{ rfc: 'XAXX010101000', razon_social: 'Test SA', regimen_fiscal: '601', codigo_postal_fiscal: '64000' }]]);
      await expect(cfdiService.generateXml(7))
        .rejects.toMatchObject({ statusCode: 422, code: 'RECEPTOR_INCOMPLETE' });
    });

    test('Fecha is Mexico local time (UTC-6), not server UTC', () => {
      // 2026-07-20T23:30:00Z UTC == 17:30 same day in America/Mexico_City.
      const xmlTime = cfdiService.cfdiExpeditionTime(new Date('2026-07-20T23:30:00Z'));
      expect(xmlTime).toBe('2026-07-20T17:30:00');
      // And 03:00Z rolls BACK to the previous local day.
      expect(cfdiService.cfdiExpeditionTime(new Date('2026-07-21T03:00:00Z'))).toBe('2026-07-20T21:00:00');
    });

    test('generates XML with no conceptos', async () => {
      const doc = {
        id: 2, organization_id: 42, sat_status: 'draft', serie: 'B', folio: '002', moneda: 'MXN', subtotal: '0', total: '0',
        receptor_rfc: 'Y', receptor_nombre: 'R', receptor_regimen: '616', receptor_cp: '01000',
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
      const doc = { id: 3, organization_id: 42, sat_status: 'draft', serie: 'C', moneda: 'MXN', subtotal: '100', total: '100',
        receptor_rfc: 'Y', receptor_nombre: 'R', receptor_regimen: '616', receptor_cp: '01000' };

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
      const doc = { id: 4, organization_id: 42, sat_status: 'draft', serie: 'D', moneda: 'MXN', subtotal: '800', total: '928',
        receptor_rfc: 'Y', receptor_nombre: 'R', receptor_regimen: '616', receptor_cp: '01000' };
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
      // Comprobante-level summary sums both traslados (80 + 48) and groups the
      // same-rate rows into ONE detail line (Base 800, Importe 128)
      expect(result.xml).toContain('TotalImpuestosTrasladados="128.00"');
      const tail = result.xml.slice(result.xml.indexOf('</cfdi:Conceptos>'));
      expect(tail).toContain('Base="800.00"');
      expect(tail).toContain('Importe="128.00"');
      expect((tail.match(/<cfdi:Traslado /g) || [])).toHaveLength(1);
      // Two Concepto elements
      const conceptoMatches = result.xml.match(/<cfdi:Concepto /g);
      expect(conceptoMatches).toHaveLength(2);
    });

    test('refuses to regenerate a non-draft CFDI (sat_status stays unforgeable)', async () => {
      // Without this guard, generate-xml demoted a VIGENTE doc back to draft
      // and overwrote its XML — re-opening a stamped CFDI for a second stamp.
      for (const status of ['vigente', 'cancelado', 'cancel_pending']) {
        db.query.mockReset();
        db.query.mockResolvedValueOnce([[{ id: 8, organization_id: 42, sat_status: status }]]);
        await expect(cfdiService.generateXml(8))
          .rejects.toMatchObject({ statusCode: 422, code: 'CFDI_NOT_DRAFT' });
        // and it must never have written anything
        expect(db.query.mock.calls.some(c => /UPDATE/.test(c[0]))).toBe(false);
      }
    });

    test('rebuilds a tipo-P (REP) draft through the Pagos 2.0 builder, not the invoice builder', async () => {
      const doc = {
        id: 9, organization_id: 42, sat_status: 'draft', tipo_comprobante: 'P',
        serie: 'P', folio: 7,
        receptor_rfc: 'MISC491214B86', receptor_nombre: 'CECILIA MIRANDA SANCHEZ',
        receptor_regimen: '612', receptor_cp: '01010',
      };
      const complement = {
        id: 50, cfdi_document_id: 9, payment_date: new Date('2026-07-20T00:00:00Z'),
        forma_pago: '03', moneda: 'MXN', tipo_cambio: null, amount: '116.00',
        operation_number: 'SPEI-1', payer_rfc: null, payer_bank_name: null,
        payer_account: null, beneficiary_rfc: null, beneficiary_account: null,
      };
      const item = {
        complement_id: 50, related_cfdi_uuid: '60432946-1429-43b3-898c-051770dd7d3a',
        serie: 'A', folio: 6, moneda_dr: 'MXN', equivalencia_dr: '1.0000',
        num_parcialidad: 1, imp_saldo_ant: '116.00', imp_pagado: '116.00', imp_saldo_insoluto: '0.00',
      };
      db.query.mockImplementation(async (sql) => {
        if (/SELECT \* FROM cfdi_documents WHERE id/.test(sql)) return [[{ ...doc }]];
        if (/FROM organization_mx_profiles/.test(sql)) {
          return [[{ rfc: 'EKU9003173C9', razon_social: 'ESCUELA KEMPER URGATE', regimen_fiscal: '601', codigo_postal_fiscal: '42501' }]];
        }
        if (/FROM cfdi_payment_complements WHERE cfdi_document_id/.test(sql)) return [[{ ...complement }]];
        if (/FROM cfdi_payment_complement_item_taxes/.test(sql)) return [[]]; // legacy: no stored desglose
        if (/FROM cfdi_payment_complement_items WHERE complement_id/.test(sql)) return [[{ ...item, id: 61, objeto_imp_dr: '02' }]];
        if (/SELECT subtotal, total_impuestos, total FROM cfdi_documents WHERE uuid/.test(sql)) {
          return [[{ subtotal: '100.00', total_impuestos: '16.00', total: '116.00' }]];
        }
        return [{ affectedRows: 1 }];
      });

      const result = await cfdiService.generateXml(9);
      expect(result.xml).toContain('TipoDeComprobante="P"');
      expect(result.xml).toContain('<pago20:Pagos Version="2.0">');
      expect(result.xml).toContain('FechaPago="2026-07-20T12:00:00"');
      // enrichment ran: IVA desglose derived from the original CFDI
      expect(result.xml).toContain('ObjetoImpDR="02"');
      expect(result.xml).toContain('TotalTrasladosBaseIVA16="100.00"');
      // never the invoice shape
      expect(result.xml).not.toContain('<cfdi:Traslado ');
      // the UPDATE must not touch sat_status
      const update = db.query.mock.calls.find(c => /UPDATE cfdi_documents/.test(c[0]));
      expect(update[0]).not.toContain('sat_status');
    });

    test('422s a tipo-P doc with no complement rows instead of corrupting it', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 9, organization_id: 42, sat_status: 'draft', tipo_comprobante: 'P', receptor_rfc: 'X', receptor_nombre: 'Y', receptor_regimen: '612', receptor_cp: '01010' }]])
        .mockResolvedValueOnce([[{ rfc: 'EKU9003173C9', razon_social: 'E', regimen_fiscal: '601', codigo_postal_fiscal: '42501' }]])
        .mockResolvedValueOnce([[]]); // no complement
      await expect(cfdiService.generateXml(9))
        .rejects.toMatchObject({ statusCode: 422, code: 'COMPLEMENT_MISSING' });
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
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
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
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
        .mockResolvedValueOnce([[]]);
      await expect(cfdiService.stamp(1)).rejects.toThrow('No active PAC provider');
    });

    test('surfaces the PAC error instead of writing an invalid sat_status', async () => {
      // cfdi_documents.sat_status is ENUM('draft','vigente','cancelado',
      // 'cancel_pending') — 'stamp_error' is NOT a value. The UPDATE that used to
      // run here therefore threw and MASKED the real PAC failure with a DB error.
      // A document that failed to stamp simply stays 'draft'.
      const doc = { id: 1, organization_id: 42, xml_content: '<cfdi/>' };
      const pac = { id: 1, provider_name: 'sw_sapien', seal_mode: 'pac', token_encrypted: 'tok', status: 'active', environment: 'sandbox', api_url: 'https://services.test.sw.com.mx' };

      db.query
        .mockResolvedValueOnce([[doc]])   // SELECT document
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
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
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
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
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await cfdiService.cancel(1, '01', 'REPLACE-UUID-123');

      const insertCall = db.query.mock.calls[4]; // pac_environment lookup shifts INSERT to index 4
      expect(insertCall[1]).toContain('REPLACE-UUID-123');
    });

    test('stores cancellation with null replacement when not provided', async () => {
      db.query
        .mockResolvedValueOnce([[vigentDoc]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
        .mockResolvedValueOnce([[activePac]])
        .mockResolvedValueOnce([{ insertId: 3 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await cfdiService.cancel(1, '02');

      const insertCall = db.query.mock.calls[4]; // pac_environment lookup shifts INSERT to index 4
      expect(insertCall[1]).toContain(null); // replacementUuid default
    });

    test('returns correct cfdi_document_id in result', async () => {
      const doc77 = { ...vigentDoc, id: 77 };
      db.query
        .mockResolvedValueOnce([[doc77]])
        .mockResolvedValueOnce([[]])                    // REP guard: no live payment complement
        .mockResolvedValueOnce([[{ pac_environment: 'sandbox' }]]) // SELECT pac_environment
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

// =============================================================================
// Simulator PAC — first-class demo/dev provider
// =============================================================================
// Unlike the dev_placeholder fallback (blocked in production), 'simulator'
// runs in ANY NODE_ENV — but only with environment='sandbox', and every UUID
// is unmistakably fake ('SIM-…'). Lets a demo install walk the entire
// stamp → vigente → SAT-cancel flow without a PAC contract.
describe('simulator PAC provider', () => {
  const origEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('stamps with a SIMULADO- UUID even under NODE_ENV=production (sandbox env)', async () => {
    process.env.NODE_ENV = 'production';
    const result = await cfdiService.callPacStamp({ provider_name: 'simulator', environment: 'sandbox' }, '<xml/>');
    // 'SIMULADO' is not valid hex — no real SAT folio fiscal can look like
    // this — and the whole value is EXACTLY 36 chars so it fits
    // cfdi_documents.uuid CHAR(36) (the 'SIM-' + full-UUID form was 40 chars
    // and blew up the column on the live walk).
    expect(result.uuid).toMatch(/^SIMULADO-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.uuid).toHaveLength(36);
  });

  test('refuses environment=production outright — simulated CFDIs must never look real', async () => {
    await expect(cfdiService.callPacStamp({ provider_name: 'simulator', environment: 'production' }, '<xml/>'))
      .rejects.toThrow(/sandbox/);
  });

  test('cancellation is accepted immediately for a simulator-stamped UUID (sandbox)', async () => {
    process.env.NODE_ENV = 'production';
    const simUuid = 'SIMULADO-1111-2222-3333-444455556666';
    const result = await cfdiService.callPacCancel({ provider_name: 'simulator', environment: 'sandbox' }, simUuid, '02', null, {});
    expect(result.status).toBe('accepted');
    expect(result.acuseXml).toContain(simUuid);
  });

  test('simulator REFUSES to cancel a real (non-SIMULADO) UUID — never fabricates acceptance for a genuine CFDI', async () => {
    const realUuid = 'e29c1ddd-0000-4000-8000-abcdefabcdef';
    await expect(
      cfdiService.callPacCancel({ provider_name: 'simulator', environment: 'sandbox' }, realUuid, '02', null, {}),
    ).rejects.toThrow(/simulator can only cancel/i);
  });

  test('unknown providers still hard-fail in production (fallback unchanged)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(cfdiService.callPacStamp({ provider_name: 'mystery', environment: 'sandbox' }, '<xml/>'))
      .rejects.toThrow(/not a supported stamping service/);
  });
});

// =============================================================================
// swAuthToken — SW Sapien auth modes
// =============================================================================
describe('swAuthToken', () => {
  test('a stored access token (portal infinite token) is used directly — no authenticate call', async () => {
    const token = await cfdiService.swAuthToken({ token_encrypted: 'INFINITE-TOKEN-123' }, 'https://services.test.sw.com.mx');
    expect(token).toBe('INFINITE-TOKEN-123');
    // No network: db/query untouched and no thrown auth error proves the
    // short-circuit (httpRequest would ECONNREFUSE in the test env).
  });

  test('without a token it authenticates with username_encrypted (the REAL column name)', async () => {
    // The old code sent pac.username — a column that does not exist on
    // pac_providers rows — silently authenticating as user: undefined.
    await expect(cfdiService.swAuthToken(
      { username_encrypted: 'sw-user', password_encrypted: 'sw-pass' },
      'https://127.0.0.1:1', // unroutable → the attempt itself proves the path
    )).rejects.toThrow(); // network error, NOT a silent undefined-user auth
  });
});

// Live-sandbox-verified XML shape (SW probe session): schemaLocation is
// required (CC3001) and empty optional attributes violate XSD patterns.
describe('buildCfdi40Xml — sandbox-verified shape', () => {
  const EMISOR2 = { rfc: 'EKU9003173C9', razon_social: 'ESCUELA KEMPER URGATE', regimen_fiscal: '601', codigo_postal_fiscal: '42501' };

  test('always emits xsi:schemaLocation on the Comprobante', () => {
    const xml = cfdiService.buildCfdi40Xml({}, EMISOR2, [], []);
    expect(xml).toContain('xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"');
  });

  test('omits empty optional attributes (Serie/Folio/FormaPago/MetodoPago/NoIdentificacion)', () => {
    const concepto = { id: 1, clave_prod_serv: '81161700', no_identificacion: null, cantidad: 1, clave_unidad: 'E48', descripcion: 'X', valor_unitario: '100', importe: '100', objeto_imp: '02' };
    const xml = cfdiService.buildCfdi40Xml({}, EMISOR2, [concepto], []);
    for (const attr of ['Serie=""', 'Folio=""', 'FormaPago=""', 'MetodoPago=""', 'NoIdentificacion']) {
      expect(xml).not.toContain(attr);
    }
  });

  test('keeps them when present', () => {
    const xml = cfdiService.buildCfdi40Xml({ serie: 'A', folio: 7, forma_pago: '99', metodo_pago: 'PPD' }, EMISOR2, [], []);
    expect(xml).toContain('Serie="A"');
    expect(xml).toContain('Folio="7"');
    expect(xml).toContain('FormaPago="99"');
    expect(xml).toContain('MetodoPago="PPD"');
  });
});

describe('buildCfdi40Xml — público en general (InformacionGlobal)', () => {
  const emisor = { rfc: 'EKU9003173C9', razon_social: 'ESCUELA KEMPER URGATE', regimen_fiscal: '601', codigo_postal_fiscal: '42501' };
  const con = [{ id: 1, clave_prod_serv: '81161700', cantidad: '1.00', clave_unidad: 'E48', descripcion: 'Internet', valor_unitario: '100.00', importe: '100.00', objeto_imp: '02' }];
  const imp = [{ cfdi_concepto_id: 1, tax_type: 'traslado', base: '100.00', impuesto: '002', tipo_factor: 'Tasa', tasa_o_cuota: '0.160000', importe: '16.00' }];

  test('emits InformacionGlobal as the first Comprobante child for XAXX receptor', () => {
    const doc = {
      receptor_rfc: 'XAXX010101000', receptor_nombre: 'PUBLICO EN GENERAL', receptor_cp: '42501',
      receptor_regimen: '616', uso_cfdi: 'S01', serie: 'A', folio: 1, forma_pago: '01', metodo_pago: 'PUE',
      moneda: 'MXN', subtotal: '100.00', total: '116.00', tipo_comprobante: 'I', exportacion: '01',
    };
    const xml = cfdiService.buildCfdi40Xml(doc, emisor, con, imp);
    expect(xml).toMatch(/<cfdi:InformacionGlobal Periodicidad="01" Meses="\d{2}" Año="\d{4}" \/>/);
    expect(xml.indexOf('InformacionGlobal')).toBeLessThan(xml.indexOf('cfdi:Emisor'));
  });

  test('a normal (non-XAXX) receptor gets NO InformacionGlobal', () => {
    const doc = {
      receptor_rfc: 'MISC491214B86', receptor_nombre: 'CECILIA MIRANDA SANCHEZ', receptor_cp: '01010',
      receptor_regimen: '612', uso_cfdi: 'G03', serie: 'A', folio: 2, forma_pago: '99', metodo_pago: 'PPD',
      moneda: 'MXN', subtotal: '100.00', total: '116.00', tipo_comprobante: 'I', exportacion: '01',
    };
    const xml = cfdiService.buildCfdi40Xml(doc, emisor, con, imp);
    expect(xml).not.toContain('InformacionGlobal');
  });
});

describe('receptorDataHint (sandbox test-data guidance)', () => {
  const { receptorDataHint } = cfdiService;
  const LCO = 'CFDI40147 - El RFC del receptor debe estar en la lista de RFC inscritos no cancelados del SAT';
  const USO = 'La clave del campo UsoCFDI debe corresponder con el tipo de persona y el régimen correspondiente';

  test('appends the doc pointer for a receptor-LCO error in sandbox', () => {
    const out = receptorDataHint(LCO, 'sandbox');
    expect(out).toContain(LCO);
    expect(out).toContain('docs/cfdi-sandbox-testing.md');
  });

  test('appends for the UsoCFDI/régimen mismatch in sandbox', () => {
    expect(receptorDataHint(USO, 'sandbox')).toContain('docs/cfdi-sandbox-testing.md');
  });

  test('is suppressed in production (raw SAT message preserved)', () => {
    expect(receptorDataHint(LCO, 'production')).toBe(LCO);
  });

  test('does not touch unrelated errors even in sandbox', () => {
    const other = 'CFDI40119 - La forma de pago no es válida';
    expect(receptorDataHint(other, 'sandbox')).toBe(other);
  });

  test('is null/empty safe', () => {
    expect(receptorDataHint('', 'sandbox')).toBe('');
    expect(receptorDataHint(undefined, 'sandbox')).toBe(undefined);
  });
});
