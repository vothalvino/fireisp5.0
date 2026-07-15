// =============================================================================
// FireISP 5.0 — Invoice Routes
// =============================================================================

const { Router } = require('express');
const Invoice = require('../models/Invoice');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInvoice, updateInvoice, patchInvoice, addInvoiceItem } = require('../middleware/schemas/invoices');
const billingService = require('../services/billingService');
const inventoryDrawdownService = require('../services/inventoryDrawdownService');
const db = require('../config/database');
const { AppError, NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();
// A voided invoice is terminal: any edit is rejected (PUT/PATCH that isn't a
// re-void). Un-voiding back to 'issued' would also leave the reversed balance
// ledger out of sync, so it must not be possible. Setting status to 'void' is
// routed to voidInvoice (below), not through this hook.
const ctrl = crudController(Invoice, {
  beforeUpdate: (old) => {
    if (old.status === 'void') {
      throw new AppError('Voided invoices cannot be modified.', 422, 'INVOICE_VOID');
    }
  },
});

router.use(authenticate);
router.use(orgScope);

// Void transition handler (shared by PUT and PATCH).
// Delegates to billingService.voidInvoiceById which is the single source of truth
// for all void business logic (allocation release, ledger zeroing, audit log).
// Both this single-invoice path and the bulk endpoint (POST /bulk/invoices/void)
// call the same service function to ensure identical behaviour.
async function voidInvoice(req, res, next) {
  try {
    const record = await billingService.voidInvoiceById(req.params.id, req.orgId, req.user?.id);
    res.json({ data: record });
  } catch (err) {
    next(err);
  }
}

router.get('/', requirePermission('invoices.view'), ctrl.list);
router.get('/:id', requirePermission('invoices.view'), ctrl.get);
router.post('/', requirePermission('invoices.create'), validate(createInvoice), ctrl.create);
router.put('/:id', requirePermission('invoices.update'), validate(updateInvoice),
  (req, res, next) => (req.body.status === 'void' ? voidInvoice(req, res, next) : ctrl.update(req, res, next)));
router.patch('/:id', requirePermission('invoices.update'), validate(patchInvoice),
  (req, res, next) => (req.body.status === 'void' ? voidInvoice(req, res, next) : ctrl.partialUpdate(req, res, next)));
router.delete('/:id', requirePermission('invoices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('invoices.update'), ctrl.restore);

// Invoice line items
router.get('/:id/items', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Add invoice line item. When the line carries an inventory_item_id (a
// product picked from the catalog rather than a free-text charge), the item
// insert, stock drawdown, and sell_to_client ledger row all run in ONE
// transaction (src/services/inventoryDrawdownService.js) — see PR brief
// "Inventory Phase 2". Free-text/non-inventory lines are unchanged: no
// transaction is opened, same as before this feature existed.
router.post('/:id/items', requirePermission('invoices.update'), validate(addInvoiceItem), async (req, res, next) => {
  try {
    if (!req.body.inventory_item_id) {
      // Org-scoped + void-guarded even for the plain (non-inventory) path —
      // no transaction is opened here since there's no drawdown, but the
      // invoice must still be looked up to enforce both. Mirrors the
      // beforeUpdate INVOICE_VOID guard on PUT/PATCH (top of this file).
      const [[invoice]] = await db.query(
        'SELECT id, status FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
        [req.params.id, req.orgId],
      );
      if (!invoice) throw new NotFoundError('Invoice');
      if (invoice.status === 'void') {
        throw new AppError('Voided invoices cannot be modified.', 422, 'INVOICE_VOID');
      }
      const item = await Invoice.addItem({ invoice_id: req.params.id, ...req.body });
      return res.status(201).json({ data: item });
    }

    // Integer-quantity guard: invoice_items.quantity is DECIMAL(10,2) but
    // inventory_stock/inventory_transactions move whole units, so a
    // fractional quantity here (e.g. 1.5) would silently round on drawdown
    // below. Free-text/service lines (no inventory_item_id) keep fractional
    // quantities — this check only fires for inventory-linked lines.
    if (!Number.isInteger(req.body.quantity)) {
      throw new ValidationError(
        'quantity must be a whole number for inventory-linked line items',
        [{ field: 'quantity', message: 'Quantity must be an integer when inventory_item_id is set' }],
      );
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Org-scoped invoice lookup — also closes a pre-existing gap where this
      // route never verified the invoice belonged to the caller's org before
      // writing to it; needed here regardless to source client_id/invoice_number
      // for the ledger row. status drives the void guard below.
      const [[invoice]] = await conn.execute(
        'SELECT id, client_id, invoice_number, status FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
        [req.params.id, req.orgId],
      );
      if (!invoice) throw new NotFoundError('Invoice');
      if (invoice.status === 'void') {
        throw new AppError('Voided invoices cannot be modified.', 422, 'INVOICE_VOID');
      }

      // Org-ownership check (mirrors Phase 1's checks in src/routes/inventory.js)
      // — 422 on cross-org/nonexistent, never a raw FK-violation 500.
      const [[invItem]] = await conn.execute(
        'SELECT id FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
        [req.body.inventory_item_id, req.orgId],
      );
      if (!invItem) {
        throw new ValidationError(
          'inventory_item_id does not reference a valid item for this organization',
          [{ field: 'inventory_item_id', message: 'Invalid or cross-organization inventory item' }],
        );
      }

      const item = await Invoice.addItem({ invoice_id: req.params.id, ...req.body }, conn.execute.bind(conn));

      await inventoryDrawdownService.drawdownForSale(conn.execute.bind(conn), {
        orgId: req.orgId,
        itemId: req.body.inventory_item_id,
        quantity: req.body.quantity,
        unitPrice: req.body.unit_price,
        invoiceId: invoice.id,
        clientId: invoice.client_id,
        performedBy: req.user?.id,
        reference: invoice.invoice_number,
      });

      await conn.commit();
      res.status(201).json({ data: item });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

// Generate invoice — supports two modes:
//   Legacy: { contract_id }  → billing-period invoice for a single contract
//   Flexible: { client_id, items: [{type, ...}] } → multi-item invoice
router.post('/generate', requirePermission('invoices.create'), async (req, res, next) => {
  try {
    const { contract_id, client_id, items } = req.body;

    // ----------------------------------------------------------------
    // LEGACY FORMAT: { contract_id }
    // ----------------------------------------------------------------
    if (contract_id && !client_id) {
      if (typeof contract_id !== 'number' || contract_id < 1) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_id must be a positive number' } });
      }
      const [contracts] = await db.query(
        'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
        [contract_id, req.orgId],
      );
      if (!contracts[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
      }
      const contract = contracts[0];
      // No deleted_at filter: an EXISTING contract must keep billing even when its
      // plan has been archived (soft-deleted). New contracts on archived plans are
      // blocked at contract-creation time, not here.
      const [plans] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
      if (!plans[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
      }
      const period = await billingService.generateBillingPeriod(contract);
      const invoice = await billingService.generateInvoice(period, contract, plans[0], req.orgId);
      return res.status(201).json({ data: invoice });
    }

    // ----------------------------------------------------------------
    // FLEXIBLE FORMAT: { client_id, items: [{type, ...}] }
    // ----------------------------------------------------------------
    if (!client_id || !Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Provide either contract_id (legacy) or client_id with a non-empty items array',
        },
      });
    }

    // Validate client belongs to org
    const [clientRows] = await db.query(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [client_id, req.orgId],
    );
    if (!clientRows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
    }

    // Pre-process items (billing-period lookups happen outside the tx)
    const lineItems = [];
    const billingPeriodUpdates = []; // { periodId }
    let currency = 'USD';
    let subtotal = 0;
    const contractIds = new Set(); // distinct contracts referenced by contract-charge items

    for (const item of items) {
      const type = item.type;

      if (type === 'contract') {
        if (!item.contract_id) {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_id is required for contract-charge items' } });
        }
        const [contractRows] = await db.query(
          'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
          [item.contract_id, req.orgId],
        );
        if (!contractRows[0]) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Contract ${item.contract_id} not found` } });
        }
        const contract = contractRows[0];
        contractIds.add(contract.id);

        // No deleted_at filter: an existing contract bills against its plan even
        // when that plan has been archived (see the legacy path above).
        const [planRows] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
        if (!planRows[0]) {
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Plan not found for contract' } });
        }
        const plan = planRows[0];

        const period = await billingService.generateBillingPeriod(contract);
        const price = parseFloat(contract.price_override || plan.price);
        currency = plan.currency || 'USD';

        const periodStart = String(period.period_start).slice(0, 10);
        const periodEnd = String(period.period_end).slice(0, 10);
        lineItems.push({
          description: `${plan.name} — ${periodStart} to ${periodEnd}`,
          quantity: 1,
          unit_price: price,
          amount: price,
        });
        billingPeriodUpdates.push({ periodId: period.id });
        subtotal += price;
      } else if (type === 'product' || type === 'custom') {
        if (!item.description || String(item.description).trim() === '') {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'description is required for product/custom items' } });
        }
        const qty = Math.max(parseFloat(item.quantity) || 1, 0.01);
        const up = Math.max(parseFloat(item.unit_price) || 0, 0);
        const amount = Math.round(qty * up * 100) / 100;

        // Optional stock link — 'product' lines only ('custom' free-text
        // lines are untouched, mirroring POST /invoices/:id/items and
        // POST /quotes/:id/items' identical inventory_item_id handling).
        // When set, this line's stock is drawn down in the SAME transaction
        // as the invoice + item INSERTs below (see the drawdownForSale call
        // in the item-insert loop further down).
        let inventoryItemId = null;
        if (type === 'product' && item.inventory_item_id) {
          // Integer-quantity guard: invoice_items.quantity is DECIMAL(10,2)
          // but inventory_stock/inventory_transactions move whole units —
          // mirrors POST /invoices/:id/items' identical guard.
          if (!Number.isInteger(qty)) {
            throw new ValidationError(
              'quantity must be a whole number for inventory-linked line items',
              [{ field: 'quantity', message: 'Quantity must be an integer when inventory_item_id is set' }],
            );
          }
          // Org-ownership check (mirrors POST /invoices/:id/items) — 422 on
          // cross-org/nonexistent, never a raw FK-violation deep inside the
          // transaction below.
          const [[invItem]] = await db.query(
            'SELECT id FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
            [item.inventory_item_id, req.orgId],
          );
          if (!invItem) {
            throw new ValidationError(
              'inventory_item_id does not reference a valid item for this organization',
              [{ field: 'inventory_item_id', message: 'Invalid or cross-organization inventory item' }],
            );
          }
          inventoryItemId = item.inventory_item_id;
        }

        lineItems.push({
          description: String(item.description).trim(), quantity: qty, unit_price: up, amount,
          inventory_item_id: inventoryItemId,
        });
        subtotal += amount;
      } else {
        return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown item type: ${type}` } });
      }
    }

    // Link the invoice to a contract only when every contract-charge line points
    // at the SAME single contract, so it shows in that contract's invoices. A
    // mixed-contract or contract-less (product/custom only) invoice stays unlinked.
    const invoiceContractId = contractIds.size === 1 ? [...contractIds][0] : null;

    // Get default tax rate
    const [taxRates] = await db.query(
      'SELECT * FROM tax_rates WHERE organization_id = ? AND is_default = TRUE LIMIT 1',
      [req.orgId],
    );
    const taxRate = taxRates[0];
    // tax_rates.rate is a FRACTION (DECIMAL(5,4); e.g. 0.1600 = 16%, seeded by
    // migration 121 and rendered as rate*100 by the frontend) — NOT a whole
    // percent, so the tax amount needs an extra *100 to land in the right
    // units (500 subtotal @ 0.16 -> 80.00 tax, not 0.80).
    const taxPct = taxRate ? parseFloat(taxRate.rate) : 0;
    subtotal = Math.round(subtotal * 100) / 100;
    const taxAmount = Math.round(subtotal * taxPct * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    // Create invoice in a transaction
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Atomic per-org sequence (migration 381) — race-free under concurrent
      // invoice generation for the same org.
      const invoiceNumber = await billingService.nextInvoiceNumber(conn, req.orgId);

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);

      const [invResult] = await conn.execute(
        `INSERT INTO invoices
           (organization_id, client_id, contract_id, invoice_number, subtotal, tax_amount, total,
            currency, tax_rate, tax_rate_id, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
        [req.orgId, client_id, invoiceContractId, invoiceNumber, subtotal, taxAmount, total,
          currency, taxPct, taxRate?.id || null, dueDate],
      );
      const invoiceId = invResult.insertId;

      for (const li of lineItems) {
        await conn.execute(
          'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, inventory_item_id) VALUES (?, ?, ?, ?, ?, ?)',
          [invoiceId, li.description, li.quantity, li.unit_price, li.amount, li.inventory_item_id || null],
        );

        // Stock drawdown for a linked product line — runs on the SAME
        // transaction connection as the invoice + item INSERTs (mirrors
        // POST /quotes/:id/convert-to-invoice's inline pattern), so a
        // drawdown failure (e.g. no warehouse configured for the org) rolls
        // back the whole generate — never an invoice with no matching stock
        // movement.
        if (li.inventory_item_id) {
          await inventoryDrawdownService.drawdownForSale(conn.execute.bind(conn), {
            orgId: req.orgId,
            itemId: li.inventory_item_id,
            quantity: li.quantity,
            unitPrice: li.unit_price,
            invoiceId,
            clientId: client_id,
            performedBy: req.user?.id,
            reference: invoiceNumber,
          });
        }
      }

      for (const bp of billingPeriodUpdates) {
        await conn.execute(
          "UPDATE billing_periods SET status = 'invoiced', invoice_id = ? WHERE id = ?",
          [invoiceId, bp.periodId],
        );
      }

      await conn.execute(
        `INSERT INTO client_balance_ledger
           (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
         VALUES (?, ?, 'debit', ?, ?, 'invoice', ?, ?)`,
        [client_id, req.orgId, total, currency, invoiceId, `Invoice ${invoiceNumber}`],
      );

      await conn.commit();
      const invoice = await Invoice.findById(invoiceId);
      return res.status(201).json({ data: invoice });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

// Invoice payments
router.get('/:id/payments', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT pa.*, p.amount AS payment_amount, p.payment_method, p.payment_date
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.invoice_id = ? AND pa.deleted_at IS NULL`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Thermal receipt — plain-text monospaced format for 58mm or 80mm printers
router.get('/:id/receipt', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const thermalReceiptService = require('../services/thermalReceiptService');
    const widthStr = req.query.width;
    const width = widthStr === '58' ? 32 : 48; // 58mm → 32 chars, 80mm → 48 chars (default)
    const text = await thermalReceiptService.generateInvoiceThermalReceipt(
      parseInt(req.params.id, 10),
      { width },
    );
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    next(err);
  }
});

// Send invoice email with PDF attachment to the client
router.post('/:id/send-email', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    const pdfService = require('../services/pdfService');
    const emailTransport = require('../services/emailTransport');
    const templates = require('../views/emailTemplates');

    const [rows] = await db.query(
      `SELECT i.*,
              cl.name AS client_name, cl.email AS client_email,
              o.name AS org_name
       FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE i.id = ? AND i.deleted_at IS NULL`,
      [invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
    if (!invoice.client_email) return res.status(422).json({ error: { code: 'NO_EMAIL', message: 'Client has no email address' } });

    const locale = req.query.locale || 'en';
    const buffer = await pdfService.generateInvoicePdf(invoiceId, { locale });

    const [itemRows] = await db.query(
      'SELECT description, amount FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL',
      [invoiceId],
    );

    const template = templates.invoiceEmail({
      clientName: invoice.client_name,
      orgName: invoice.org_name,
      invoiceNumber: invoice.invoice_number,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.due_date ? String(invoice.due_date).slice(0, 10) : '',
      items: itemRows,
    });

    const result = await emailTransport.sendEmail({
      organizationId: invoice.organization_id,
      to: invoice.client_email,
      subject: template.subject,
      html: template.html,
      attachments: [{ filename: `invoice-${invoice.invoice_number || invoiceId}.pdf`, content: buffer }],
    });
    if (!result.success) {
      return res.status(502).json({ error: { code: 'EMAIL_FAILED', message: result.error || 'Failed to send email' } });
    }

    res.json({ message: 'Invoice sent', to: invoice.client_email });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
