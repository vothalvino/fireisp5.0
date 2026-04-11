// =============================================================================
// FireISP 5.0 — CFDI Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

describe('cfdiService', () => {
  beforeEach(() => jest.clearAllMocks());

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
  });

  // =========================================================================
  // generateXml
  // =========================================================================
  describe('generateXml()', () => {
    test('generates CFDI 4.0 XML for a valid document', async () => {
      const doc = {
        id: 1, serie: 'A', folio: '001', fecha_emision: '2026-01-15T12:00:00Z',
        forma_pago: '01', metodo_pago: 'PUE', tipo_comprobante: 'I',
        exportacion: '01', lugar_expedicion: '64000', moneda: 'MXN',
        subtotal: '500.00', total: '580.00',
        emisor_rfc: 'XAXX010101000', emisor_nombre: 'Test SA', emisor_regimen_fiscal: '601',
        receptor_rfc: 'XBXX020202000', receptor_nombre: 'Client', receptor_domicilio_fiscal: '64000',
        receptor_regimen_fiscal: '616', uso_cfdi: 'G03',
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

    test('generates XML with no conceptos', async () => {
      const doc = {
        id: 2, serie: 'B', folio: '002', moneda: 'MXN', subtotal: '0', total: '0',
        emisor_rfc: 'X', emisor_nombre: 'E', receptor_rfc: 'Y', receptor_nombre: 'R',
      };
      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([[]])     // no conceptos
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await cfdiService.generateXml(2);
      expect(result.xml).toContain('<cfdi:Conceptos>');
    });
  });

  // =========================================================================
  // stamp
  // =========================================================================
  describe('stamp()', () => {
    test('stamps a document with generated UUID', async () => {
      const doc = { id: 1, organization_id: 42, xml_content: '<cfdi>...</cfdi>' };
      const pac = { id: 1, provider: 'finkok', status: 'active' };

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
  });

  // =========================================================================
  // cancel
  // =========================================================================
  describe('cancel()', () => {
    test('cancels a vigente document', async () => {
      const doc = { id: 1, organization_id: 42, sat_status: 'vigente' };
      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([{ insertId: 1 }])   // INSERT cancellation
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE status

      const result = await cfdiService.cancel(1, '02');
      expect(result.status).toBe('cancel_pending');
      expect(result.reason).toBe('02');
    });

    test('throws when document not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(cfdiService.cancel(999, '01')).rejects.toThrow('CFDI document not found');
    });

    test('throws when document is not vigente', async () => {
      const doc = { id: 1, sat_status: 'cancelado' };
      db.query.mockResolvedValueOnce([[doc]]);
      await expect(cfdiService.cancel(1, '01')).rejects.toThrow('Can only cancel vigente documents');
    });

    test('passes replacement UUID for reason 01', async () => {
      const doc = { id: 1, organization_id: 42, sat_status: 'vigente' };
      db.query
        .mockResolvedValueOnce([[doc]])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await cfdiService.cancel(1, '01', 'REPLACE-UUID-123');

      const insertCall = db.query.mock.calls[1];
      expect(insertCall[1]).toContain('REPLACE-UUID-123');
    });
  });
});
