// =============================================================================
// FireISP 5.0 — Quote Routes
// =============================================================================

const { Router } = require('express');
const Quote = require('../models/Quote');
const Invoice = require('../models/Invoice');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createQuote, updateQuote, createQuoteItem } = require('../middleware/schemas/quotes');
const db = require('../config/database');
const { resolveLineItemPricing } = require('../utils/lineItemPricing');
const billingService = require('../services/billingService');
const inventoryDrawdownService = require('../services/inventoryDrawdownService');
const auditLog = require('../services/auditLog');
const { ValidationError } = require('../utils/errors');

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

// Add quote line item. Quotes never draw down stock (drawdown happens only
// when a quote converts to an invoice — see POST /:id/convert-to-invoice
// below), so this stays a plain, non-transactional insert; the only new
// behavior for Inventory Phase 2 is accepting + org-verifying inventory_item_id.
router.post('/:id/items', requirePermission('quotes.update'), validate(createQuoteItem), async (req, res, next) => {
  try {
    if (req.body.inventory_item_id) {
      // Integer-quantity guard: quote_items.quantity is DECIMAL(10,2) but
      // inventory_stock/inventory_transactions move whole units, so a
      // fractional quantity here (e.g. 1.5) would silently round on
      // drawdown when this line is later carried into an invoice via
      // POST /:id/convert-to-invoice. Free-text/service lines (no
      // inventory_item_id) keep fractional quantities — this check only
      // fires for inventory-linked lines.
      if (!Number.isInteger(req.body.quantity)) {
        throw new ValidationError(
          'quantity must be a whole number for inventory-linked line items',
          [{ field: 'quantity', message: 'Quantity must be an integer when inventory_item_id is set' }],
        );
      }
      // Org-ownership check (mirrors Phase 1's checks in src/routes/inventory.js)
      // — 422 on cross-org/nonexistent, never a raw FK-violation 500.
      const [[invItem]] = await db.query(
        'SELECT id FROM inventory_items WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
        [req.body.inventory_item_id, req.orgId],
      );
      if (!invItem) {
        throw new ValidationError(
          'inventory_item_id does not reference a valid item for this organization',
          [{ field: 'inventory_item_id', message: 'Invalid or cross-organization inventory item' }],
        );
      }
    }
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
    // Default to the organization's currency (not a hardcoded 'USD') — mirrors
    // POST /invoices/generate's identical fix. A contract-charge item's plan
    // currency, when present, still wins below.
    let currency = await Organization.getCurrency(req.orgId);
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
        currency = plan.currency || currency;

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
        // unit_price OR amount (sibling-endpoint shape) — a supplied amount
        // used to be silently ignored, minting a legitimate-looking 0.00 line.
        // Mirrors /invoices/generate exactly.
        const { qty, unitPrice: up, amount } = resolveLineItemPricing(item);

        // Optional stock link — 'product' lines only, carried through
        // unchanged to quote_items (mirrors POST /quotes/:id/items). Quotes
        // NEVER draw down stock themselves — only quote->invoice conversion
        // (POST /:id/convert-to-invoice, above) does, and it already carries
        // this same column, so a generate-created quote's linked line
        // behaves identically to one added via POST /:id/items once accepted
        // and converted.
        let inventoryItemId = null;
        if (type === 'product' && item.inventory_item_id) {
          // Integer-quantity guard — mirrors POST /quotes/:id/items and
          // POST /invoices/generate's identical guard (quote_items.quantity
          // is DECIMAL(10,2) but inventory_stock/inventory_transactions move
          // whole units, enforced at conversion time via drawdownForSale).
          if (!Number.isInteger(qty)) {
            throw new ValidationError(
              'quantity must be a whole number for inventory-linked line items',
              [{ field: 'quantity', message: 'Quantity must be an integer when inventory_item_id is set' }],
            );
          }
          // Org-ownership check (mirrors POST /quotes/:id/items) — 422 on
          // cross-org/nonexistent, never a raw FK-violation later.
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
          description: String(item.description).trim(), quantity: qty, unit_price: up,
          inventory_item_id: inventoryItemId,
        });
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
      // inventory_item_id is carried through but never drawn down here (see
      // comment above the product-item branch) — no stock/ledger writes on
      // this connection.
      for (const li of lineItems) {
        await conn.execute(
          'INSERT INTO quote_items (quote_id, description, quantity, unit_price, inventory_item_id) VALUES (?, ?, ?, ?, ?)',
          [quoteId, li.description, li.quantity, li.unit_price, li.inventory_item_id || null],
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

    // Idempotency guard (migration 390's converted_invoice_id back-reference):
    // a quote that already converted must reject a retry/double-click 409
    // instead of creating a duplicate invoice and re-running drawdownForSale
    // per linked line — checked BEFORE the status gate below because the
    // terminal write further down leaves status at 'accepted', so status
    // alone can never distinguish "never converted" from "already converted".
    if (quote.converted_invoice_id) {
      const [existing] = await db.query(
        'SELECT id, invoice_number FROM invoices WHERE id = ?',
        [quote.converted_invoice_id],
      );
      const existingInvoice = existing[0];
      return res.status(409).json({
        error: {
          code: 'CONVERSION_EXISTS',
          message: existingInvoice
            ? `This quote was already converted to invoice ${existingInvoice.invoice_number} (id ${existingInvoice.id}).`
            : `This quote was already converted to invoice id ${quote.converted_invoice_id}.`,
        },
      });
    }

    // Only an approved (accepted) quote may become an invoice — approve/reject
    // (above) is the gate.
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

      // Copy quote items to invoice items — inventory_item_id is carried
      // through unchanged (migration 390). A linked line's stock drawdown
      // happens HERE, inline, in this same transaction — this route builds
      // invoice_items via raw SQL and never calls POST /invoices/:id/items
      // internally, so a converted line is drawn down exactly once.
      const [quoteItems] = await conn.execute(
        'SELECT * FROM quote_items WHERE quote_id = ? AND deleted_at IS NULL ORDER BY id',
        [req.params.id],
      );
      for (const item of quoteItems) {
        await conn.execute(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, tax_rate_id, inventory_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [invoiceId, item.description, item.quantity, item.unit_price, item.total, item.tax_rate_id || null, item.inventory_item_id || null],
        );

        if (item.inventory_item_id) {
          await inventoryDrawdownService.drawdownForSale(conn.execute.bind(conn), {
            orgId: req.orgId,
            itemId: item.inventory_item_id,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            invoiceId,
            clientId: quote.client_id,
            performedBy: req.user?.id,
            reference: invoiceNumber,
          });
        }
      }

      // Mark quote as accepted and record the back-reference — SAME
      // transaction as the invoice INSERT above, so a crash/rollback between
      // the two is impossible: either both the invoice and this stamp exist,
      // or neither does (migration 390's idempotency fix).
      // The IS NULL condition makes the claim atomic: the early guard above is
      // check-then-act, so two near-concurrent converts can both pass it. The
      // row lock serializes them here — the loser matches 0 rows and rolls
      // back its invoice + stock drawdown instead of double-converting.
      const [stamp] = await conn.execute(
        'UPDATE quotes SET status = ?, converted_invoice_id = ? WHERE id = ? AND converted_invoice_id IS NULL',
        ['accepted', invoiceId, req.params.id],
      );
      if (stamp.affectedRows === 0) {
        await conn.rollback();
        return res.status(409).json({
          error: {
            code: 'CONVERSION_EXISTS',
            message: 'This quote was converted to an invoice by a concurrent request.',
          },
        });
      }

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
