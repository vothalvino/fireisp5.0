// =============================================================================
// FireISP 5.0 — Integration Workflow Tests
// =============================================================================
// End-to-end workflow tests simulating the full billing → CFDI → suspension cycle.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const cfdiService = require('../src/services/cfdiService');
const suspensionService = require('../src/services/suspensionService');

describe('Integration Workflow: Billing → CFDI → Suspension', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      // nextInvoiceNumber() reads back LAST_INSERT_ID() via conn.query()
      // (a plain query, not a prepared .execute()).
      query: jest.fn().mockResolvedValue([[{ id: 1 }]]),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
  });

  // =========================================================================
  // Full billing cycle
  // =========================================================================
  describe('Billing Cycle', () => {
    test('generates period → invoice → records payment credit', async () => {
      const contract = { id: 1, start_date: '2026-01-01', billing_day: 15, client_id: 100, plan_id: 5, price_override: null, tax_rate_id: null };
      const plan = { name: 'Basic 50Mbps', price: '500.00', currency: 'MXN' };

      // Step 1: Generate billing period
      const pendingPeriod = { id: 10, contract_id: 1, status: 'pending', period_start: '2026-01-01', period_end: '2026-01-31' };
      db.query
        .mockResolvedValueOnce([[]])  // no pending
        .mockResolvedValueOnce([[]])  // no last invoiced
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([[pendingPeriod]]);

      const period = await billingService.generateBillingPeriod(contract);
      expect(period.status).toBe('pending');

      // Step 2: Generate invoice
      // rate = 0.1600 (16%) — DECIMAL(5,4) FRACTION per schema/migration 121,
      // not the whole-percent '16.00' an earlier version of this test used
      // (which coincidentally matched the pre-fix formula's output and masked
      // a 100x tax-amount bug).
      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
        .mockResolvedValueOnce([[{ id: 1, rate: '0.1600', is_default: true }]])  // tax rate
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 50 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT line item
        .mockResolvedValueOnce([[]])  // no addons
        .mockResolvedValueOnce([])  // UPDATE billing period
        .mockResolvedValueOnce([]);  // INSERT ledger debit
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      db.query.mockResolvedValueOnce([[{ id: 50, invoice_number: 'INV-000001', total: '580.00', status: 'issued' }]]);

      const invoice = await billingService.generateInvoice(period, contract, plan, 42);
      expect(invoice.status).toBe('issued');
      expect(invoice.total).toBe('580.00');

      // 500 subtotal @ 16% -> 80.00 tax, 580.00 total. Assert directly on the
      // INSERT INTO invoices params so this fails if the tax formula regresses.
      const invoiceInsert = mockConnection.execute.mock.calls[4][1];
      expect(invoiceInsert[4]).toBe(500);   // subtotal
      expect(invoiceInsert[5]).toBe(80);    // tax_amount
      expect(invoiceInsert[6]).toBe(580);   // total

      // Step 3: Record payment credit
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);
      const payment = { id: 77, client_id: 100, amount: '580.00', currency: 'MXN', reference: 'PAY-001' };
      await billingService.recordPaymentCredit(payment, 42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_balance_ledger'),
        expect.arrayContaining([100, 42, '580.00', 'MXN', 77]),
      );
    });
  });

  // =========================================================================
  // CFDI lifecycle
  // =========================================================================
  describe('CFDI Lifecycle', () => {
    test('generates XML → stamps → can cancel', async () => {
      // Step 1: Generate XML
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 42, emisor_rfc: 'ABC123', receptor_rfc: 'XYZ789', subtotal: 500, total: 580 }]])
        .mockResolvedValueOnce([[{ id: 1, cfdi_document_id: 1, clave_prod_serv: '43231500', cantidad: 1, clave_unidad: 'E48', descripcion: 'Internet', valor_unitario: 500, importe: 500, objeto_imp: '02' }]])
        .mockResolvedValueOnce([[]])  // no taxes
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE xml_content

      const xmlResult = await cfdiService.generateXml(1);
      expect(xmlResult.xml).toContain('cfdi:Comprobante');
      expect(xmlResult.xml).toContain('Version="4.0"');

      // Step 2: Stamp (will use fallback UUID since no real PAC)
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 42, xml_content: xmlResult.xml }]])
        .mockResolvedValueOnce([[{ id: 1, provider_name: 'test', status: 'active' }]])  // PAC provider
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE uuid

      const stampResult = await cfdiService.stamp(1);
      expect(stampResult.uuid).toBeDefined();
      expect(stampResult.status).toBe('vigente');

      // Step 3: Cancel
      db.query
        .mockResolvedValueOnce([[{ id: 1, sat_status: 'vigente', organization_id: 42, uuid: stampResult.uuid, emisor_rfc: 'ABC123' }]])
        .mockResolvedValueOnce([[{ id: 1, provider_name: 'test', status: 'active', environment: 'sandbox' }]])  // PAC provider
        .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT cancellation
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE → cancel_pending
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE cancellation with PAC response
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE → cancelado

      const cancelResult = await cfdiService.cancel(1, '02', null);
      expect(cancelResult.status).toBe('cancelado');
    });
  });

  // =========================================================================
  // Suspension → Reconnect cycle
  // =========================================================================
  describe('Suspension → Reconnect', () => {
    test('evaluates rules → suspends → reconnects', async () => {
      // Step 1: Evaluate rules
      const rule = { id: 1, days_past_due: 15, grace_period_days: 5, action: 'auto_suspend', is_enabled: true };
      const contract = { id: 10, status: 'active', invoice_id: 50, days_overdue: 20 };

      db.query
        .mockResolvedValueOnce([[rule]])     // rules
        .mockResolvedValueOnce([[contract]]);  // contracts

      const results = await suspensionService.evaluateRules(42);
      expect(results).toHaveLength(1);
      expect(results[0].contract.days_overdue).toBe(20);

      // Step 2: Suspend
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      db.query.mockResolvedValueOnce([[]]);  // RADIUS lookup (none)

      await suspensionService.suspendContract(10, 1, 5, 50);

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE contracts SET status'),
        ['suspended', 10],
      );

      // Step 3: Reconnect
      jest.clearAllMocks();
      db.getConnection.mockResolvedValue(mockConnection);
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      db.query.mockResolvedValueOnce([[]]);  // RADIUS lookup (none)
      db.query.mockResolvedValueOnce([[]]);  // walled-garden check — no open restriction

      await suspensionService.reconnectContract(10, 5, 50);

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE contracts SET status'),
        ['active', 10],
      );
    });
  });
});
