// =============================================================================
// FireISP 5.0 — PDF Service Tests
// =============================================================================

jest.mock('../src/config/database');
const db = require('../src/config/database');
const pdfService = require('../src/services/pdfService');

describe('PDF Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- Helper function tests ----

  describe('fmt()', () => {
    it('formats amounts with 2 decimal places', () => {
      expect(pdfService.fmt(100, 'USD')).toBe('USD 100.00');
      expect(pdfService.fmt(99.9, 'MXN')).toBe('MXN 99.90');
      expect(pdfService.fmt(0, 'EUR')).toBe('EUR 0.00');
    });

    it('handles null/undefined amounts', () => {
      expect(pdfService.fmt(null)).toBe('USD 0.00');
      expect(pdfService.fmt(undefined)).toBe('USD 0.00');
    });

    it('handles string amounts', () => {
      expect(pdfService.fmt('250.50', 'MXN')).toBe('MXN 250.50');
    });
  });

  describe('fmtDate()', () => {
    it('formats dates as YYYY-MM-DD', () => {
      expect(pdfService.fmtDate('2026-04-01T12:00:00Z')).toBe('2026-04-01');
    });

    it('returns empty string for null', () => {
      expect(pdfService.fmtDate(null)).toBe('');
      expect(pdfService.fmtDate(undefined)).toBe('');
    });
  });

  describe('statusColor()', () => {
    it('returns success color for paid/active/vigente', () => {
      const green = pdfService.statusColor('paid');
      expect(green).toBe('#27ae60');
      expect(pdfService.statusColor('active')).toBe('#27ae60');
      expect(pdfService.statusColor('vigente')).toBe('#27ae60');
    });

    it('returns danger color for overdue/cancelled/suspended', () => {
      expect(pdfService.statusColor('overdue')).toBe('#c0392b');
      expect(pdfService.statusColor('cancelled')).toBe('#c0392b');
      expect(pdfService.statusColor('suspended')).toBe('#c0392b');
    });

    it('returns muted color for unknown status', () => {
      expect(pdfService.statusColor('draft')).toBe('#7f8c8d');
    });
  });

  // ---- PDF Generation tests ----

  describe('generateInvoicePdf()', () => {
    it('generates a valid PDF buffer for an invoice', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1,
          invoice_number: 'INV-000001',
          subtotal: 500,
          tax_amount: 80,
          total: 580,
          currency: 'MXN',
          status: 'issued',
          due_date: '2026-05-01',
          created_at: '2026-04-01',
          first_name: 'Juan',
          last_name: 'García',
          email: 'juan@example.com',
          phone: '+52 555 123 4567',
          address: 'Av. Reforma 123',
          city: 'CDMX',
          state: 'CDMX',
          country: 'MX',
          org_name: 'Test ISP',
          org_email: 'admin@testisp.com',
          org_phone: '+52 555 999 0000',
          org_address: 'Insurgentes 456',
          org_city: 'CDMX',
          org_state: 'CDMX',
          org_country: 'MX',
          client_id: 1,
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([[
          { id: 1, description: 'Internet 100 Mbps — Apr 2026', quantity: 1, unit_price: 500, amount: 500 },
        ]]);

      const buffer = await pdfService.generateInvoicePdf(1);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
      // PDF magic bytes
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for non-existent invoice', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generateInvoicePdf(999)).rejects.toThrow('Invoice not found');
    });
  });

  describe('generateCreditNotePdf()', () => {
    it('generates a valid PDF buffer for a credit note', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1,
          credit_note_number: 'CN-000001',
          total: 200,
          currency: 'USD',
          reason: 'Service outage',
          created_at: '2026-04-01',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          org_name: 'Test ISP',
        }]])
        .mockResolvedValueOnce([[
          { id: 1, description: 'Partial refund', quantity: 1, amount: 200 },
        ]]);

      const buffer = await pdfService.generateCreditNotePdf(1);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for non-existent credit note', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generateCreditNotePdf(999)).rejects.toThrow('Credit note not found');
    });

    it('generates a credit note PDF with Spanish locale', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 2,
          credit_note_number: 'CN-000002',
          total: 150,
          currency: 'MXN',
          reason: 'Interrupción de servicio',
          created_at: '2026-04-01',
          first_name: 'Juan',
          last_name: 'García',
          email: 'juan@example.com',
          org_name: 'Test ISP',
        }]])
        .mockResolvedValueOnce([[
          { id: 1, description: 'Reembolso parcial', quantity: 1, amount: 150 },
        ]]);

      const buffer = await pdfService.generateCreditNotePdf(2, { locale: 'es' });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  describe('generateQuotePdf()', () => {
    it('generates a valid PDF buffer for a quote', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1,
          quote_number: 'QT-000001',
          subtotal: 1000,
          tax_amount: 160,
          total: 1160,
          currency: 'MXN',
          status: 'draft',
          valid_until: '2026-05-01',
          notes: 'Includes installation',
          created_at: '2026-04-01',
          first_name: 'María',
          last_name: 'López',
          email: 'maria@example.com',
          org_name: 'Test ISP',
        }]])
        .mockResolvedValueOnce([[
          { id: 1, description: 'Internet 200 Mbps — Monthly', quantity: 12, unit_price: 83.33, amount: 1000 },
        ]]);

      const buffer = await pdfService.generateQuotePdf(1);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for non-existent quote', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generateQuotePdf(999)).rejects.toThrow('Quote not found');
    });

    it('generates a quote PDF with Spanish locale', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 2,
          quote_number: 'QT-000002',
          subtotal: 2000,
          tax_amount: 320,
          total: 2320,
          currency: 'MXN',
          status: 'sent',
          valid_until: '2026-06-01',
          notes: 'Incluye instalación',
          created_at: '2026-04-01',
          first_name: 'Carlos',
          last_name: 'Rodríguez',
          email: 'carlos@example.com',
          org_name: 'Test ISP',
        }]])
        .mockResolvedValueOnce([[
          { id: 1, description: 'Internet 500 Mbps — Mensual', quantity: 12, unit_price: 166.67, amount: 2000 },
        ]]);

      const buffer = await pdfService.generateQuotePdf(2, { locale: 'es' });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  describe('generateCfdiPdf()', () => {
    it('generates a valid PDF buffer for a CFDI document', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1,
          uuid: 'abc123-def456-ghi789',
          serie: 'A',
          folio: '001',
          emisor_rfc: 'TEST010101AAA',
          emisor_nombre: 'Test ISP S.A.',
          emisor_regimen_fiscal: '601',
          receptor_rfc: 'XAXX010101000',
          receptor_nombre: 'PUBLICO EN GENERAL',
          receptor_regimen_fiscal: '616',
          uso_cfdi: 'S01',
          tipo_comprobante: 'I',
          metodo_pago: 'PUE',
          forma_pago: '03',
          moneda: 'MXN',
          exportacion: '01',
          lugar_expedicion: '06600',
          fecha_emision: '2026-04-01',
          subtotal: 500,
          total: 580,
          sat_status: 'vigente',
          sello_sat: 'ABCDEF1234567890',
          org_name: 'Test ISP',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([[
          { id: 1, clave_prod_serv: '81161700', descripcion: 'Servicio de internet', cantidad: 1, valor_unitario: 500, importe: 500, objeto_imp: '02' },
        ]]);

      const buffer = await pdfService.generateCfdiPdf(1);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for non-existent CFDI document', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generateCfdiPdf(999)).rejects.toThrow('CFDI document not found');
    });

    it('generates a CFDI PDF with Spanish locale', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 2,
          uuid: 'xyz789-abc123-def456',
          serie: 'B',
          folio: '002',
          emisor_rfc: 'TEST010101AAA',
          emisor_nombre: 'Test ISP S.A.',
          emisor_regimen_fiscal: '601',
          receptor_rfc: 'GARC901010AAA',
          receptor_nombre: 'Juan García',
          receptor_regimen_fiscal: '612',
          uso_cfdi: 'G03',
          tipo_comprobante: 'I',
          metodo_pago: 'PUE',
          forma_pago: '03',
          moneda: 'MXN',
          exportacion: '01',
          lugar_expedicion: '06600',
          fecha_emision: '2026-04-01',
          subtotal: 1000,
          total: 1160,
          sat_status: 'vigente',
          sello_sat: 'ABCDEF1234567890ABCDEF',
          org_name: 'Test ISP',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([[
          { id: 1, clave_prod_serv: '81161700', descripcion: 'Servicio de internet', cantidad: 1, valor_unitario: 1000, importe: 1000, objeto_imp: '02' },
        ]]);

      const buffer = await pdfService.generateCfdiPdf(2, { locale: 'es' });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  // ---- Payment Receipt PDF ----

  describe('generatePaymentReceiptPdf()', () => {
    it('generates a valid PDF buffer for a payment receipt', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 1,
          client_id: 1,
          amount: 580,
          currency: 'MXN',
          payment_date: '2026-04-15',
          payment_method: 'bank_transfer',
          reference_number: 'TXN-12345',
          bank_name: 'BBVA',
          clabe: '012345678901234567',
          notes: 'Monthly internet payment',
          created_at: '2026-04-15T10:00:00Z',
          first_name: 'Juan',
          last_name: 'García',
          email: 'juan@example.com',
          phone: '+52 555 123 4567',
          address: 'Av. Reforma 123',
          city: 'CDMX',
          state: 'CDMX',
          country: 'MX',
          org_name: 'Test ISP',
          org_email: 'admin@testisp.com',
          org_phone: '+52 555 999 0000',
          org_address: 'Insurgentes 456',
          org_city: 'CDMX',
          org_state: 'CDMX',
          org_country: 'MX',
        }]])
        .mockResolvedValueOnce([[
          { allocated_amount: 580, invoice_number: 'INV-000001', invoice_total: 580, invoice_currency: 'MXN', invoice_status: 'paid' },
        ]]);

      const buffer = await pdfService.generatePaymentReceiptPdf(1);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for non-existent payment', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generatePaymentReceiptPdf(999)).rejects.toThrow('Payment not found');
    });

    it('generates a receipt PDF with Spanish locale', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 2,
          client_id: 2,
          amount: 1160,
          currency: 'MXN',
          payment_date: '2026-04-15',
          payment_method: 'spei',
          reference_number: 'SPEI-99887',
          bank_name: 'Banorte',
          clabe: null,
          notes: null,
          created_at: '2026-04-15T14:00:00Z',
          first_name: 'María',
          last_name: 'López',
          email: 'maria@example.com',
          phone: null,
          address: null,
          city: null,
          state: null,
          country: null,
          org_name: 'Test ISP',
          org_email: null,
          org_phone: null,
          org_address: null,
          org_city: null,
          org_state: null,
          org_country: null,
        }]])
        .mockResolvedValueOnce([[]]);

      const buffer = await pdfService.generatePaymentReceiptPdf(2, { locale: 'es' });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('generates a receipt PDF with no allocations', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 3,
          client_id: 1,
          amount: 250,
          currency: 'USD',
          payment_date: '2026-04-10',
          payment_method: 'cash',
          reference_number: null,
          bank_name: null,
          clabe: null,
          notes: null,
          created_at: '2026-04-10T08:00:00Z',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          phone: null,
          address: null,
          city: null,
          state: null,
          country: null,
          org_name: 'Test ISP',
          org_email: null,
          org_phone: null,
          org_address: null,
          org_city: null,
          org_state: null,
          org_country: null,
        }]])
        .mockResolvedValueOnce([[]]);

      const buffer = await pdfService.generatePaymentReceiptPdf(3);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('generates a receipt with multiple allocations', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 4,
          client_id: 1,
          amount: 1500,
          currency: 'MXN',
          payment_date: '2026-04-15',
          payment_method: 'credit_card',
          reference_number: 'CC-ABC123',
          bank_name: null,
          clabe: null,
          notes: 'Split across two invoices',
          created_at: '2026-04-15T09:00:00Z',
          first_name: 'Ana',
          last_name: 'Martínez',
          email: 'ana@example.com',
          phone: '+52 555 111 2222',
          address: 'Calle 5 de Mayo 100',
          city: 'Puebla',
          state: 'Puebla',
          country: 'MX',
          org_name: 'Test ISP',
          org_email: 'info@testisp.com',
          org_phone: '+52 555 888 0000',
          org_address: 'Blvd Norte 789',
          org_city: 'Puebla',
          org_state: 'Puebla',
          org_country: 'MX',
        }]])
        .mockResolvedValueOnce([[
          { allocated_amount: 800, invoice_number: 'INV-000010', invoice_total: 800, invoice_currency: 'MXN', invoice_status: 'paid' },
          { allocated_amount: 700, invoice_number: 'INV-000011', invoice_total: 700, invoice_currency: 'MXN', invoice_status: 'paid' },
        ]]);

      const buffer = await pdfService.generatePaymentReceiptPdf(4);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  // ---- Client ledger statement PDF ----

  describe('generateClientLedgerPdf()', () => {
    const client = {
      id: 14, name: 'Acme Corp', email: 'acme@example.com', phone: '+52 555 000 1111',
      org_name: 'Test ISP', org_email: 'admin@testisp.com',
      org_address: 'Insurgentes 456', org_city: 'CDMX', org_state: 'CDMX', org_country: 'MX',
    };
    const entries = [
      { entry_type: 'invoice', amount: '580.00', currency: 'MXN', reference_type: 'invoice', reference_id: 100, description: 'Invoice INV-000100', created_at: '2026-04-01T00:00:00Z' },
      { entry_type: 'payment', amount: '580.00', currency: 'MXN', reference_type: 'payment', reference_id: 10, description: 'Payment PAY-1', created_at: '2026-04-15T00:00:00Z' },
    ];

    it('generates an all-time statement (no opening-balance query)', async () => {
      db.query
        .mockResolvedValueOnce([[client]])
        .mockResolvedValueOnce([entries]);

      const buffer = await pdfService.generateClientLedgerPdf(14, { orgId: 1 });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
      expect(db.query).toHaveBeenCalledTimes(2); // client + entries, no opening-balance query
    });

    it('generates a date-range statement with an opening balance (es locale)', async () => {
      db.query
        .mockResolvedValueOnce([[client]])
        .mockResolvedValueOnce([[{ opening: '120.00' }]])
        .mockResolvedValueOnce([[entries[1]]]);

      const buffer = await pdfService.generateClientLedgerPdf(14, { from: '2026-06-01', to: '2026-06-30', orgId: 1, locale: 'es' });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
      expect(db.query).toHaveBeenCalledTimes(3); // client + opening + entries
      const entriesSql = db.query.mock.calls[2][0];
      expect(entriesSql).toContain('created_at >=');
      expect(entriesSql).toContain('DATE_ADD');
    });

    it('renders an empty all-time statement without throwing', async () => {
      db.query
        .mockResolvedValueOnce([[client]])
        .mockResolvedValueOnce([[]]);

      const buffer = await pdfService.generateClientLedgerPdf(14, { orgId: 1 });
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('throws for a non-existent client', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await expect(pdfService.generateClientLedgerPdf(999, { orgId: 1 })).rejects.toThrow('Client not found');
    });
  });
});
