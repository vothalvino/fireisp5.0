// =============================================================================
// FireISP 5.0 — Credit Note Routes
// =============================================================================

const { Router } = require('express');
const CreditNote = require('../models/CreditNote');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { requireMxLocale } = require('../middleware/orgLocale');
const { validate } = require('../middleware/validate');
const { createCreditNote, updateCreditNote, createCreditNoteItem, stampCreditNote } = require('../middleware/schemas/creditNotes');
const creditNoteCfdiService = require('../services/creditNoteCfdiService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(CreditNote);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('credit_notes.view'), ctrl.list);
router.get('/:id', requirePermission('credit_notes.view'), ctrl.get);
router.post('/', requirePermission('credit_notes.create'), validate(createCreditNote), async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    // Default currency when the caller omits one: prefer the linked
    // invoice's own currency (a credit note against an invoice should be
    // denominated the same way that invoice is), otherwise the org's
    // currency — never a hardcoded 'USD'. An explicitly-set currency in the
    // request always wins.
    if (!req.body.currency) {
      let invoiceCurrency = null;
      if (req.body.invoice_id) {
        const [[invoiceRow]] = await db.query(
          'SELECT currency FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
          [req.body.invoice_id, req.orgId],
        );
        invoiceCurrency = invoiceRow?.currency || null;
      }
      req.body.currency = invoiceCurrency || await Organization.getCurrency(req.orgId);
    }
    const creditNote = await CreditNote.create(req.body);

    // Credit client balance ledger
    if (creditNote.client_id && creditNote.total) {
      await db.query(
        `INSERT INTO client_balance_ledger (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
         VALUES (?, ?, 'credit', ?, ?, 'credit_note', ?, ?)`,
        [creditNote.client_id, req.orgId, creditNote.total, creditNote.currency,
          creditNote.id, `Credit Note ${creditNote.credit_note_number || creditNote.id}`],
      );
    }

    res.status(201).json({ data: creditNote });
  } catch (err) {
    next(err);
  }
});
router.put('/:id', requirePermission('credit_notes.update'), validate(updateCreditNote), ctrl.update);
router.delete('/:id', requirePermission('credit_notes.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('credit_notes.update'), ctrl.restore);

// Stamp as CFDI de Egreso: convert this credit note into a tipo-E CFDI related
// (TipoRelacion 01) to the credited invoice's vigente CFDI and submit it to the
// org's PAC. MX-locale orgs only; permission mirrors direct CFDI creation. The
// service enforces every fiscal precondition (org+client MX profiles, stampable
// status, a vigente related ingreso, single-CFDI-per-credit-note) with
// actionable 4xx errors.
router.post('/:id/stamp', requireMxLocale, requirePermission('cfdi_documents.create'), validate(stampCreditNote), async (req, res, next) => {
  try {
    const result = await creditNoteCfdiService.stampCreditNote(req.params.id, req.orgId, {
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

// Credit note line items
router.get('/:id/items', requirePermission('credit_notes.view'), async (req, res, next) => {
  try {
    const items = await CreditNote.getItems(req.params.id);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items', requirePermission('credit_notes.update'), validate(createCreditNoteItem), async (req, res, next) => {
  try {
    const item = await CreditNote.addItem({ credit_note_id: req.params.id, ...req.body });
    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
