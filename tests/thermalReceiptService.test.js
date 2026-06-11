// =============================================================================
// Tests: Thermal Receipt Service
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const thermalReceiptService = require('../src/services/thermalReceiptService');

describe('thermalReceiptService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // generateInvoiceThermalReceipt
  // ---------------------------------------------------------------------------

  describe('generateInvoiceThermalReceipt', () => {
    const mockInvoice = [{
      id: 1,
      invoice_number: 'INV-000001',
      client_name: 'Alice Smith',
      client_email: 'alice@example.com',
      client_phone: '+1 555 0100',
      org_name: 'Test ISP',
      org_phone: '+1 555 0200',
      org_email: 'billing@testisp.com',
      status: 'issued',
      created_at: '2026-06-01T00:00:00.000Z',
      due_date: '2026-06-15T00:00:00.000Z',
      subtotal: 100,
      tax_amount: 16,
      total: 116,
      currency: 'MXN',
    }];
    const mockItems = [
      { description: 'Internet Service Plan Basic', quantity: 1, unit_price: 100, amount: 100 },
    ];

    it('returns a string for a valid invoice at 48-char width', async () => {
      db.query
        .mockResolvedValueOnce([mockInvoice])
        .mockResolvedValueOnce([mockItems]);

      const text = await thermalReceiptService.generateInvoiceThermalReceipt(1);
      expect(typeof text).toBe('string');
      expect(text).toContain('INV-000001');
      expect(text).toContain('Test ISP');
      expect(text).toContain('Alice Smith');
    });

    it('returns a narrower receipt at 32-char width (58mm)', async () => {
      db.query
        .mockResolvedValueOnce([mockInvoice])
        .mockResolvedValueOnce([mockItems]);

      const text = await thermalReceiptService.generateInvoiceThermalReceipt(1, { width: 32 });
      // No line should exceed 32 chars (except for the trailing newline)
      const lines = text.split('\n').filter(l => l !== '');
      const tooLong = lines.filter(l => l.length > 32);
      expect(tooLong).toHaveLength(0);
    });

    it('throws when invoice not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // empty result
      await expect(thermalReceiptService.generateInvoiceThermalReceipt(999)).rejects.toThrow('Invoice not found');
    });

    it('includes TOTAL line with currency', async () => {
      db.query
        .mockResolvedValueOnce([mockInvoice])
        .mockResolvedValueOnce([mockItems]);

      const text = await thermalReceiptService.generateInvoiceThermalReceipt(1);
      expect(text).toContain('MXN 116.00');
    });
  });

  // ---------------------------------------------------------------------------
  // generatePaymentThermalReceipt
  // ---------------------------------------------------------------------------

  describe('generatePaymentThermalReceipt', () => {
    const mockPayment = [{
      id: 5,
      amount: 116,
      currency: 'MXN',
      payment_method: 'cash',
      reference_number: 'REF-001',
      bank_name: null,
      payment_date: '2026-06-10T00:00:00.000Z',
      created_at: '2026-06-10T00:00:00.000Z',
      client_name: 'Bob Jones',
      client_email: 'bob@example.com',
      client_phone: '+1 555 0300',
      org_name: 'Test ISP',
      org_phone: '+1 555 0200',
    }];
    const mockAllocs = [
      { allocated_amount: 116, invoice_number: 'INV-000001' },
    ];

    it('returns a receipt string for a valid payment', async () => {
      db.query
        .mockResolvedValueOnce([mockPayment])
        .mockResolvedValueOnce([mockAllocs]);

      const text = await thermalReceiptService.generatePaymentThermalReceipt(5);
      expect(typeof text).toBe('string');
      expect(text).toContain('Bob Jones');
      expect(text).toContain('MXN 116.00');
      expect(text).toContain('INV-000001');
    });

    it('throws when payment not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // empty result
      await expect(thermalReceiptService.generatePaymentThermalReceipt(999)).rejects.toThrow('Payment not found');
    });

    it('handles no allocations gracefully', async () => {
      db.query
        .mockResolvedValueOnce([mockPayment])
        .mockResolvedValueOnce([[]]); // no allocations

      const text = await thermalReceiptService.generatePaymentThermalReceipt(5);
      expect(text).not.toContain('Applied to invoices');
    });
  });
});
