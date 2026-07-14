// =============================================================================
// FireISP 5.0 — Quote Routes
// =============================================================================

const { Router } = require('express');
const Quote = require('../models/Quote');
const Invoice = require('../models/Invoice');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createQuote, updateQuote, createQuoteItem } = require('../middleware/schemas/quotes');
const db = require('../config/database');
const billingService = require('../services/billingService');
const auditLog = require('../services/auditLog');

const router = Router();
const ctrl = crudController(Quote);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('quotes.view'), ctrl.list);
router.get('/:id', requirePermission('quotes.view'), ctrl.get);
// Auto-assign quote_number (migration 389's organization_quote_sequences,
// mirroring how invoice_number is never required from the caller) when the
// request didn't supply one. The number-advance and the quote INSERT run on
// the SAME connection/transaction — nextQuoteNumber's advance commits or
// rolls back together with the row it was drawn for, so a failed INSERT
// (bad FK, pool exhaustion, DB blip) never permanently burns a sequence
// value. (An earlier version of this handler ran the advance in its own
// short-lived transaction and then called the generic, separately-connected
// ctrl.create — that let a failed create burn a number for nothing, unlike
// nextInvoiceNumber's documented contract and POST /quotes/generate below,
// which have always shared one transaction for both writes.)
//
// When an explicit quote_number IS supplied there's no sequence to protect,
// so the plain crudController path (ctrl.create) is used unchanged.
router.post('/', requirePermission('quotes.create'), validate(createQuote), async (req, res, next) => {
  try {
    if (req.body.quote_number) {
      return ctrl.create(req, res, next);
    }

    if (req.orgId) req.body.organization_id = req.orgId;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      req.body.quote_number = await billingService.nextQuoteNumber(conn, req.orgId);

      // Same fillable-filtering INSERT BaseModel.create() would run, but on
      // the transaction's own connection instead of the pool — Quote.fillable
      // stays the single source of truth for which columns are writable.
      const filtered = {};
      for (const key of Quote.fillable) {
        if (req.body[key] !== undefined) filtered[key] = req.body[key];
      }
      const cols = Object.keys(filtered);
      const placeholders = cols.map(() => '?').join(', ');
      const [result] = await conn.execute(
        `INSERT INTO quotes (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        Object.values(filtered),
      );

      await conn.commit();

      const record = await Quote.findByIdIncludingDeleted(result.insertId);

      await auditLog.log({
        userId: req.user?.id,
        organizationId: req.orgId,
        action: 'create',
        tableName: Quote.tableName,
        recordId: record.id,
        newValues: req.body,
      });

      return res.status(201).json({ data: record });
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
router.put('/:id', requirePermission('quotes.update'), validate(updateQuote), ctrl.update);
router.delete('/:id', requirePermission('quotes.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('quotes.update'), ctrl.restore);

// Get quote line items
router.get('/:id/items', requirePermission('quotes.view'), async (req, res, next) => {
  try {
    const items = await Quote.getItems(req.params.id);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

// Add quote line item
router.post('/:id/items', requirePermission('quotes.update'), validate(createQuoteItem), async (req, res, next) => {
  try {
    const item = await Quote.addItem({ quote_id: req.params.id, ...req.body });
    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

// Generate a quote with line items in one shot — mirrors POST
// /invoices/generate's FLEXIBLE format ({ client_id, items: [...] }) as
// closely as a quote (an unbilled estimate) can. This is the real "create a
// quote like an invoice" flow: the frontend's GenerateQuoteModal is a clone
// of GenerateInvoiceModal (same client/contract/product-catalog pickers,
// same three item types), submitting everything here at once instead of the
// per-item POST /:id/items above (which still exists for adding items to an
// already-created quote from QuoteDetail).
//
// Deliberately does NOT reuse billingService.generateBillingPeriod() for
// 'contract' items — that function has side effects (creates or reuses a
// REAL billing_periods row, later marked 'invoiced' when an actual invoice
// is generated). A quote is just an estimate that may never be accepted, so
// resolving its price here is read-only: contract + plan lookup only, same
// price fallback (`contract.price_override || plan.price`) invoice
// generation uses, no billing_periods write.
//
// 'product' and 'custom' items are handled identically to
// POST /invoices/generate (the type tag is a frontend/UX distinction only —
// both trust the client-supplied description/quantity/unit_price; the
// product catalog lookup that fills those in happens client-side against the
// same GET /plans/addons/catalog GenerateInvoiceModal already uses).
router.post('/generate', requirePermission('quotes.create'), async (req, res, next) => {
  try {
    const { client_id, items } = req.body;

    if (!client_id || !Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'client_id and a non-empty items array are required',
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

    // Pre-process items (read-only — no billing_periods writes for a quote)
    const lineItems = [];
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

        // No deleted_at filter: an existing contract can be quoted against
        // its plan even when that plan has been archived (mirrors invoice
        // generation's identical comment).
        const [planRows] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
        if (!planRows[0]) {
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Plan not found for contract' } });
        }
        const plan = planRows[0];

        const price = parseFloat(contract.price_override || plan.price);
        currency = plan.currency || 'USD';

        lineItems.push({
          description: `${plan.name} (Contract #${contract.id})`,
          quantity: 1,
          unit_price: price,
        });
        subtotal += price;
      } else if (type === 'product' || type === 'custom') {
        if (!item.description || String(item.description).trim() === '') {
          return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'description is required for product/custom items' } });
        }
        const qty = Math.max(parseFloat(item.quantity) || 1, 0.01);
        const up = Math.max(parseFloat(item.unit_price) || 0, 0);
        const amount = Math.round(qty * up * 100) / 100;
        lineItems.push({ description: String(item.description).trim(), quantity: qty, unit_price: up });
        subtotal += amount;
      } else {
        return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown item type: ${type}` } });
      }
    }

    // Link the quote to a contract only when every contract-charge line
    // points at the SAME single contract (mirrors invoice generation).
    const quoteContractId = contractIds.size === 1 ? [...contractIds][0] : null;

    // Same default-tax-rate lookup + fraction math as POST /invoices/generate
    // — tax_rate is a FRACTION (e.g. 0.1600 = 16%), never multiplied by an
    // extra 100.
    const [taxRates] = await db.query(
      'SELECT * FROM tax_rates WHERE organization_id = ? AND is_default = TRUE LIMIT 1',
      [req.orgId],
    );
    const taxRate = taxRates[0];
    const taxPct = taxRate ? parseFloat(taxRate.rate) : 0;
    subtotal = Math.round(subtotal * 100) / 100;
    const taxAmount = Math.round(subtotal * taxPct * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Atomic per-org sequence (migration 389, mirroring migration 381) —
      // race-free under concurrent quote generation for the same org.
      const quoteNumber = await billingService.nextQuoteNumber(conn, req.orgId);

      const [quoteResult] = await conn.execute(
        `INSERT INTO quotes
           (organization_id, client_id, contract_id, quote_number, subtotal, tax_amount,
            total, currency, tax_rate, tax_rate_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [req.orgId, client_id, quoteContractId, quoteNumber, subtotal, taxAmount, total,
          currency, taxPct, taxRate?.id || null],
      );
      const quoteId = quoteResult.insertId;

      // No per-item tax_rate_id (NULL = inherit from the parent quote),
      // matching POST /invoices/generate's invoice_items INSERT exactly.
      for (const li of lineItems) {
        await conn.execute(
          'INSERT INTO quote_items (quote_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [quoteId, li.description, li.quantity, li.unit_price],
        );
      }

      await conn.commit();
      const quote = await Quote.findById(quoteId, req.orgId);
      return res.status(201).json({ data: quote });
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

// Approve a quote — any user with quotes.update (no dedicated approval
// permission; see PR brief) can accept a quote in any status, including
// re-deciding an already accepted/rejected one. Org-scoped + soft-delete
// guarded via BaseModel.update (WHERE organization_id = ? AND deleted_at IS NULL).
router.post('/:id/approve', requirePermission('quotes.update'), async (req, res, next) => {
  try {
    const updated = await Quote.update(req.params.id, { status: 'accepted' }, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Reject a quote — same permission and leniency as approve (see above).
router.post('/:id/reject', requirePermission('quotes.update'), async (req, res, next) => {
  try {
    const updated = await Quote.update(req.params.id, { status: 'rejected' }, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Convert quote to invoice
router.post('/:id/convert-to-invoice', requirePermission('quotes.create'), requirePermission('invoices.create'), async (req, res, next) => {
  try {
    const [quotes] = await db.query(
      'SELECT * FROM quotes WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!quotes[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Quote not found' } });
    }
    const quote = quotes[0];

    // Only an approved (accepted) quote may become an invoice — approve/reject
    // (above) is the gate. A quote already converted has no separate "converted"
    // status to detect (quotes carries no invoice_id back-reference), so this is
    // the only guard available without a migration.
    if (quote.status !== 'accepted') {
      return res.status(409).json({
        error: {
          code: 'QUOTE_NOT_ACCEPTED',
          message: `Only accepted quotes can be converted to an invoice (current status: ${quote.status}).`,
        },
      });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Generate a unique invoice number within the transaction — atomic
      // per-org sequence (migration 381), race-free under concurrent
      // invoice generation for the same org.
      const invoiceNumber = await billingService.nextInvoiceNumber(conn, req.orgId);

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);

      // Create invoice from quote — all writes run on the transaction connection
      const [invResult] = await conn.execute(
        `INSERT INTO invoices
           (organization_id, client_id, contract_id, invoice_number, subtotal, tax_amount,
            total, currency, tax_rate, tax_rate_id, due_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
        [req.orgId, quote.client_id, quote.contract_id, invoiceNumber, quote.subtotal,
          quote.tax_amount, quote.total, quote.currency, quote.tax_rate,
          quote.tax_rate_id, dueDate, quote.notes],
      );
      const invoiceId = invResult.insertId;

      // Copy quote items to invoice items
      const [quoteItems] = await conn.execute(
        'SELECT * FROM quote_items WHERE quote_id = ? AND deleted_at IS NULL ORDER BY id',
        [req.params.id],
      );
      for (const item of quoteItems) {
        await conn.execute(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, tax_rate_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [invoiceId, item.description, item.quantity, item.unit_price, item.total, item.tax_rate_id || null],
        );
      }

      // Mark quote as accepted
      await conn.execute(
        'UPDATE quotes SET status = ? WHERE id = ?',
        ['accepted', req.params.id],
      );

      await conn.commit();
      const invoice = await Invoice.findById(invoiceId);
      res.status(201).json({ data: invoice });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
