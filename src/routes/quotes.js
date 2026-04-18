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

const router = Router();
const ctrl = crudController(Quote);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('quotes.view'), ctrl.list);
router.get('/:id', requirePermission('quotes.view'), ctrl.get);
router.post('/', requirePermission('quotes.create'), validate(createQuote), ctrl.create);
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

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Create invoice from quote
      const invoiceData = {
        organization_id: req.orgId,
        client_id: quote.client_id,
        contract_id: quote.contract_id,
        subtotal: quote.subtotal,
        tax_amount: quote.tax_amount,
        total: quote.total,
        currency: quote.currency,
        tax_rate: quote.tax_rate,
        tax_rate_id: quote.tax_rate_id,
        status: 'pending',
        notes: quote.notes,
      };
      const invoice = await Invoice.create(invoiceData);

      // Copy quote items to invoice items
      const quoteItems = await Quote.getItems(req.params.id);
      for (const item of quoteItems) {
        await Invoice.addItem({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          amount: item.amount,
          tax_rate_id: item.tax_rate_id,
        });
      }

      // Mark quote as accepted
      await conn.query(
        'UPDATE quotes SET status = ? WHERE id = ?',
        ['accepted', req.params.id],
      );

      await conn.commit();
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
