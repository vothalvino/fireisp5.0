// =============================================================================
// FireISP 5.0 — Invoice Routes
// =============================================================================

const { Router } = require('express');
const Invoice = require('../models/Invoice');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInvoice, updateInvoice, patchInvoice, addInvoiceItem, stampInvoice } = require('../middleware/schemas/invoices');
const billingService = require('../services/billingService');
const invoiceCfdiService = require('../services/invoiceCfdiService');
const { requireMxLocale } = require('../middleware/orgLocale');
const inventoryDrawdownService = require('../services/inventoryDrawdownService');
const db = require('../config/database');
const { resolveLineItemPricing } = require('../utils/lineItemPricing');
const { AppError, NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ route: 'invoices' });

const router = Router();
// A terminal invoice is immutable: 'void' (internal discard of an unstamped
// invoice) and 'cancelled' (its CFDI was cancelled at SAT) both released the
// invoice's money — un-terminating back to 'issued' would leave the reversed
// balance ledger out of sync and, for 'cancelled', resurrect an invoice whose
// CFDI is permanently cancelado on file at SAT. Setting status to 'void' is
// routed to voidInvoice (below), not through this hook.
function assertInvoiceNotTerminal(status) {
  if (status === 'void') {
    throw new AppError('Voided invoices cannot be modified.', 422, 'INVOICE_VOID');
  }
  if (status === 'cancelled') {
    throw new AppError('This invoice was cancelled at SAT — it is fiscally terminal and cannot be modified.', 422, 'INVOICE_CANCELLED');
  }
}

const ctrl = crudController(Invoice, {
  beforeUpdate: (old) => {
    assertInvoiceNotTerminal(old.status);
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

// "overdue" is a DERIVED state, not a persisted status: nothing in the system
// ever writes invoices.status='overdue' (analyticsService, lateFeeService,
// clientBalanceService and the payment reminders all COMPUTE it as
// issued/sent + past due_date). So the generic status filter — which matches
// the literal column — always returned zero for ?status=overdue. Translate it
// to the same derived condition everyone else uses. All other status values
// fall through to the generic list unchanged.
router.get('/', requirePermission('invoices.view'), async (req, res, next) => {
  if (req.query.status !== 'overdue') return ctrl.list(req, res, next);
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const WHERE = `WHERE organization_id = ? AND deleted_at IS NULL
        AND status IN ('issued', 'sent', 'overdue') AND due_date < NOW()`;
    const [rows] = await db.query(
      `SELECT * FROM invoices ${WHERE} ORDER BY due_date ASC LIMIT ${limit} OFFSET ${offset}`,
      [req.orgId],
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices ${WHERE}`,
      [req.orgId],
    );
    // Present the derived state honestly: a row filtered as overdue displays as
    // overdue even if its stored column still reads 'issued'/'sent'.
    res.json({
      data: rows.map(r => ({ ...r, status: 'overdue' })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});
router.get('/:id', requirePermission('invoices.view'), ctrl.get);
// Composite create: an invoice and its line items land in ONE transaction.
// The generic ctrl.create had two real bugs here (both hit live via the raw
// API): invoice_number is NOT NULL in the DB but optional in the schema and
// never auto-generated → raw MySQL error 500; and `items` was silently
// dropped (validate() ignores undeclared fields, fillable strips them) — a
// "successful" create produced an invoice with ZERO line items, which is
// fiscally dangerous: a later CFDI conversion builds its conceptos FROM
// those items.
router.post('/', requirePermission('invoices.create'), validate(createInvoice), async (req, res, next) => {
  try {
    // Nested array fields bypass validate() (it does not recurse) — validate
    // each item by hand against the same rules as POST /:id/items.
    let cleanItems = [];
    if (req.body.items !== undefined) {
      if (!Array.isArray(req.body.items)) {
        throw new AppError('items must be an array of line items.', 422, 'VALIDATION_ERROR');
      }
      cleanItems = req.body.items.map((it, i) => {
        const description = typeof it?.description === 'string' ? it.description.trim() : '';
        const quantity = it?.quantity === undefined ? 1 : Number(it.quantity);
        const unitPrice = Number(it?.unit_price);
        const amount = it?.amount === undefined
          ? Math.round(quantity * unitPrice * 100) / 100
          : Number(it.amount);
        if (!description || description.length > 255) {
          throw new AppError(`items[${i}].description is required (1–255 chars).`, 422, 'VALIDATION_ERROR');
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new AppError(`items[${i}].quantity must be a positive number.`, 422, 'VALIDATION_ERROR');
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new AppError(`items[${i}].unit_price must be a non-negative number.`, 422, 'VALIDATION_ERROR');
        }
        if (!Number.isFinite(amount) || amount < 0) {
          throw new AppError(`items[${i}].amount must be a non-negative number.`, 422, 'VALIDATION_ERROR');
        }
        return { description, quantity, unit_price: unitPrice, amount };
      });
      // The invoice IS its lines: a declared subtotal that contradicts the
      // items would stamp a CFDI whose conceptos don't add up.
      const sum = Math.round(cleanItems.reduce((s, it) => s + it.amount, 0) * 100) / 100;
      if (Math.abs(sum - Number(req.body.subtotal)) > 0.01) {
        throw new AppError(
          `The line items sum to ${sum.toFixed(2)} but subtotal is ${Number(req.body.subtotal).toFixed(2)}.`,
          422, 'ITEMS_SUBTOTAL_MISMATCH',
        );
      }
    }

    // Tax consistency — an MX invoice with mismatched tax stamps to a SAT
    // rejection (CFDI40119: tax total ≠ subtotal × rate), caught live.
    // invoices.tax_rate is a DECIMAL(5,4) FRACTION (max 9.9999) — a percent
    // like 16 overflows into a raw 500, and the schema's max:100 is a lie.
    // Precedence for the tax figures, so a stampable invoice always results:
    //   - explicit tax_amount wins;
    //   - else derive from an explicit tax_rate (normalized percent-or-fraction);
    //   - else infer from the subtotal→total gap (the common "total already
    //     includes tax" shape).
    // Then the rate is normalized/back-derived, and both invariants checked.
    const subtotalNum = Number(req.body.subtotal);
    const totalNum = Number(req.body.total);
    const rateProvided = req.body.tax_rate !== undefined && req.body.tax_rate !== null;
    let taxRateFraction = rateProvided ? billingService.invoiceTaxFraction(req.body.tax_rate) : null;

    let taxAmount;
    if (req.body.tax_amount !== undefined && req.body.tax_amount !== null) {
      taxAmount = Number(req.body.tax_amount);
    } else if (taxRateFraction !== null) {
      taxAmount = Math.round(subtotalNum * taxRateFraction * 100) / 100;
    } else {
      taxAmount = Math.round((totalNum - subtotalNum) * 100) / 100;
    }

    if (taxRateFraction === null) {
      taxRateFraction = subtotalNum > 0 ? Math.round((taxAmount / subtotalNum) * 1e6) / 1e6 : 0;
    }

    const derivedTax = Math.round(subtotalNum * taxRateFraction * 100) / 100;
    if (Math.abs(taxAmount - derivedTax) > 0.01) {
      throw new AppError(
        `tax_amount ${taxAmount.toFixed(2)} does not match subtotal ${subtotalNum.toFixed(2)} × ${(taxRateFraction * 100).toFixed(2)}% = ${derivedTax.toFixed(2)}.`,
        422, 'TAX_INCONSISTENT',
      );
    }
    const expectedTotal = Math.round((subtotalNum + taxAmount) * 100) / 100;
    if (Math.abs(totalNum - expectedTotal) > 0.01) {
      throw new AppError(
        `total ${totalNum.toFixed(2)} does not equal subtotal + tax = ${expectedTotal.toFixed(2)}.`,
        422, 'TOTAL_INCONSISTENT',
      );
    }

    const conn = await db.getConnection();
    let invoiceId;
    try {
      await conn.beginTransaction();
      // DB requires invoice_number NOT NULL — auto-number from the same
      // org-scoped sequence the billing engine uses when the caller omits it.
      const invoiceNumber = req.body.invoice_number
        || await billingService.nextInvoiceNumber(conn, req.orgId);
      // tax_rate and currency are NOT NULL DEFAULT columns — binding an
      // explicit NULL bypasses the default and 500s (live-caught; mocks and
      // sql:check are both blind to bind nullability). Currency comes from
      // the ORG (one currency per org), never the table's legacy 'USD'
      // default.
      const currency = req.body.currency
        || await Organization.getCurrency(req.orgId);
      const [ins] = await conn.execute(
        `INSERT INTO invoices
           (organization_id, client_id, contract_id, invoice_number, subtotal, tax_rate,
            tax_amount, total, currency, tax_rate_id, due_date, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.orgId, req.body.client_id, req.body.contract_id ?? null, invoiceNumber,
          req.body.subtotal, taxRateFraction, taxAmount,
          req.body.total, currency, req.body.tax_rate_id ?? null,
          req.body.due_date, req.body.status ?? 'draft', req.user?.id ?? null,
        ],
      );
      invoiceId = ins.insertId;
      for (const it of cleanItems) {
        await conn.execute(
          'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)',
          [invoiceId, it.description, it.quantity, it.unit_price, it.amount],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }

    const [rows] = await db.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});
// 'cancelled' means "the CFDI was cancelled at SAT" and is set exclusively by
// the SAT cancellation flow (cfdiService → billingService.cancelInvoiceForSat),
// which also releases the invoice's money. Setting it by hand would fabricate a
// compliance state with no SAT record — and, since 'cancelled' is terminal,
// irreversibly. Discarding an unstamped invoice is 'void'; a stamped one goes
// through POST /cfdi/cancel.
function rejectManualCancelled(req, _res, next) {
  if (req.body.status === 'cancelled') {
    return next(new AppError(
      "Invoices cannot be set to 'cancelled' directly — cancel the CFDI at SAT (POST /cfdi/cancel) and the invoice follows, or use 'void' for an unstamped invoice.",
      422, 'INVOICE_CANCELLED',
    ));
  }
  return next();
}

router.put('/:id', requirePermission('invoices.update'), validate(updateInvoice), rejectManualCancelled,
  (req, res, next) => (req.body.status === 'void' ? voidInvoice(req, res, next) : ctrl.update(req, res, next)));
router.patch('/:id', requirePermission('invoices.update'), validate(patchInvoice), rejectManualCancelled,
  (req, res, next) => (req.body.status === 'void' ? voidInvoice(req, res, next) : ctrl.partialUpdate(req, res, next)));
router.delete('/:id', requirePermission('invoices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('invoices.update'), ctrl.restore);

// Stamp-later: convert this invoice into a CFDI 4.0 and submit it to the
// org's PAC. MX-locale orgs only; permission mirrors direct CFDI creation.
// The service enforces every fiscal precondition (org+client MX profiles,
// stampable status, single-CFDI-per-invoice) with actionable 4xx errors.
router.post('/:id/stamp', requireMxLocale, requirePermission('cfdi_documents.create'), validate(stampInvoice), async (req, res, next) => {
  try {
    const result = await invoiceCfdiService.stampInvoice(req.params.id, req.orgId, {
      uso_cfdi: req.body.uso_cfdi,
      forma_pago: req.body.forma_pago,
      userId: req.user?.id,
    });
    // Always 200: the conversion itself succeeded. `stamped: false` +
    // `stamp_error` reports a retryable PAC failure (doc stays 'draft').
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

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
// After a line is added, the invoice's stored subtotal/tax/total must follow —
// before this existed, POST /:id/items left them untouched, so the invoice
// (and the client's computed balance) silently under-billed by the full line
// amount. The quarterly DR drill's financial-consistency check is what
// surfaced it. The totals move by the line's DELTA (never a recompute from
// lines — manual invoices carry totals with no line items); `FOR UPDATE` on
// the invoice row serializes concurrent adds; the balance-ledger delta debit
// mirrors the one POST /generate writes for the original total.
async function applyItemTotals(conn, invoice, orgId, lineAmount) {
  const delta = await billingService.applyLineItemToTotals(
    conn.execute.bind(conn), invoice.id, invoice.tax_rate, lineAmount,
  );
  if (delta > 0) {
    await conn.execute(
      `INSERT INTO client_balance_ledger
         (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'debit', ?, ?, 'invoice', ?, ?)`,
      [invoice.client_id, orgId, delta, invoice.currency, invoice.id,
        `Invoice ${invoice.invoice_number} — line item added`],
    );
  }
}

// A line's `amount` is what drives the invoice totals and the ledger, while
// quantity/unit_price drive stock drawdown and the GENERATED items.total
// column — an inconsistent pair writes wrong money somewhere no matter which
// side you trust. Every internal writer computes amount = quantity ×
// unit_price; hold API callers to the same identity (±1¢ for rounding).
function assertAmountMatchesLine(body) {
  const expected = Math.round(body.quantity * body.unit_price * 100) / 100;
  if (Math.abs(body.amount - expected) > 0.01) {
    throw new ValidationError(
      'amount must equal quantity × unit_price',
      [{ field: 'amount', message: `amount ${body.amount} does not match quantity × unit_price (${expected})` }],
    );
  }
}

// Amounts on an invoice with a live (stamped) CFDI are fiscally frozen — the
// XML on file with SAT is immutable, so growing the invoice would make the
// system disagree with the legal document. Cancel/substitute the CFDI first.
async function assertNoLiveCfdi(exec, invoiceId) {
  const [rows] = await exec(
    // 'draft' freezes amounts too: its conceptos were derived from the current
    // line items, and it may be stamped at any moment.
    "SELECT id FROM cfdi_documents WHERE invoice_id = ? AND sat_status IN ('draft', 'vigente', 'cancel_pending') LIMIT 1",
    [invoiceId],
  );
  if (rows && rows[0]) {
    throw new AppError(
      'Invoice has a stamped CFDI — amounts are fiscally frozen. Cancel or substitute the CFDI before modifying line items.',
      422, 'CFDI_STAMPED',
    );
  }
}

// Post-commit paid-status refresh is best-effort: the money is already
// durably committed, so a transient failure here must never turn the request
// into a 5xx (a retry would double-add the line). Worst case the invoice
// stays 'paid' until the next payment-side refresh touches it.
async function refreshPaidStatusBestEffort(invoiceId) {
  try {
    await billingService.refreshInvoicePaidStatus(invoiceId);
  } catch (err) {
    logger.warn({ err, invoiceId }, 'post-add-item paid-status refresh failed (non-fatal)');
  }
}

router.post('/:id/items', requirePermission('invoices.update'), validate(addInvoiceItem), async (req, res, next) => {
  try {
    assertAmountMatchesLine(req.body);

    if (!req.body.inventory_item_id) {
      // Plain (non-inventory) path — transactional since the totals update
      // must be atomic with the item insert. Org-scoped + void-guarded,
      // mirroring the beforeUpdate INVOICE_VOID guard on PUT/PATCH.
      const conn = await db.getConnection();
      let item;
      try {
        await conn.beginTransaction();
        const [[invoice]] = await conn.execute(
          `SELECT id, client_id, invoice_number, status, tax_rate, total, currency
           FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL FOR UPDATE`,
          [req.params.id, req.orgId],
        );
        if (!invoice) throw new NotFoundError('Invoice');
        assertInvoiceNotTerminal(invoice.status);
        await assertNoLiveCfdi(conn.execute.bind(conn), invoice.id);
        item = await Invoice.addItem({ invoice_id: req.params.id, ...req.body }, conn.execute.bind(conn));
        await applyItemTotals(conn, invoice, req.orgId, req.body.amount);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      // A grown total can turn a fully-paid invoice back into an underpaid
      // one — reuse the existing allocation-vs-total status refresh.
      await refreshPaidStatusBestEffort(req.params.id);
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
    let item;
    try {
      await conn.beginTransaction();

      // Org-scoped invoice lookup — also closes a pre-existing gap where this
      // route never verified the invoice belonged to the caller's org before
      // writing to it; needed here regardless to source client_id/invoice_number
      // for the ledger row. status drives the void guard below; FOR UPDATE
      // serializes concurrent adds for the totals recompute.
      const [[invoice]] = await conn.execute(
        `SELECT id, client_id, invoice_number, status, tax_rate, total, currency
         FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, req.orgId],
      );
      if (!invoice) throw new NotFoundError('Invoice');
      assertInvoiceNotTerminal(invoice.status);
      await assertNoLiveCfdi(conn.execute.bind(conn), invoice.id);

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

      item = await Invoice.addItem({ invoice_id: req.params.id, ...req.body }, conn.execute.bind(conn));

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

      await applyItemTotals(conn, invoice, req.orgId, req.body.amount);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await refreshPaidStatusBestEffort(req.params.id);
    res.status(201).json({ data: item });
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
    // Default to the organization's currency (not a hardcoded 'USD') so a
    // product/custom-only invoice — one with no 'contract' line to pull a
    // plan currency from — still lands in the org's real currency. A
    // contract-charge item's plan currency, when present, still wins below.
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

        // No deleted_at filter: an existing contract bills against its plan even
        // when that plan has been archived (see the legacy path above).
        const [planRows] = await db.query('SELECT * FROM plans WHERE id = ?', [contract.plan_id]);
        if (!planRows[0]) {
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Plan not found for contract' } });
        }
        const plan = planRows[0];

        const period = await billingService.generateBillingPeriod(contract);
        const price = parseFloat(contract.price_override || plan.price);
        currency = plan.currency || currency;

        // DATE columns arrive as JS Date objects — String(d).slice(0,10) yields
        // "Wed Aug 12" (year lost, TZ-shifted); ISO-slice gives "2026-08-12".
        const periodStart = new Date(period.period_start).toISOString().slice(0, 10);
        const periodEnd = new Date(period.period_end).toISOString().slice(0, 10);
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
        // unit_price OR amount (sibling-endpoint shape) — a supplied amount
        // used to be silently ignored, minting a legitimate-looking 0.00 line.
        const { qty, unitPrice: up, amount } = resolveLineItemPricing(item);

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

    // Resolve tax: client exemption > org default > MX 16% net (shared resolver).
    const tax = await billingService.resolveTaxContext(db.query, {
      orgId: req.orgId, clientId: client_id,
    });
    const taxPct = tax.rate;
    const taxRate = tax.taxRateId ? { id: tax.taxRateId } : null;
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
      dueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : '',
      items: itemRows,
    });

    const result = await emailTransport.sendEmail({
      organizationId: invoice.organization_id,
      emailFunction: 'billing',
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
