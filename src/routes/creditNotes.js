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
const billingService = require('../services/billingService');
const { AppError } = require('../utils/errors');
const db = require('../config/database');

// Header-amounts consistency: a credit note's total drives the client balance
// (POST writes a client_balance_ledger credit) and the CFDI de Egreso, but the
// three amount columns were accepted unvalidated — an inconsistent note
// (subtotal + tax ≠ total) polluted the books at create and only failed later,
// at stamp time. Reject it at the door. Fires only when both subtotal and total
// are known (a total-only note, like the refund path creates, is coherent).
function assertTotalsConsistent({ subtotal, tax_amount, total }) {
  const missing = (v) => v === null || v === undefined;
  if (missing(subtotal) || missing(total)) return;
  const sub = Number(subtotal);
  const tax = Number(tax_amount ?? 0);
  const tot = Number(total);
  if ([sub, tax, tot].some(Number.isNaN)) return; // type errors are validate()'s job
  if (Math.abs(sub + tax - tot) > 0.01) {
    throw new AppError(
      `Credit note amounts are inconsistent: subtotal (${sub.toFixed(2)}) + tax (${tax.toFixed(2)}) must equal total (${tot.toFixed(2)}).`,
      422, 'CREDIT_NOTE_TOTALS_INCONSISTENT',
    );
  }
}

/**
 * A credit note whose CFDI de Egreso is live at SAT is fiscally frozen. The
 * filed XML snapshots the amounts, the receptor and the folio, so letting the
 * row drift afterwards makes it disagree with what SAT and the client both
 * hold — unfixable after the fact. Same guard invoices got in #532; the credit
 * note paths never had one.
 *
 * 'draft' counts: a draft CFDI has already snapshotted its conceptos and is
 * waiting on a stamp retry.
 */
async function assertNoLiveCfdi(creditNoteId, orgId, remedy) {
  const [rows] = await db.query(
    `SELECT id, sat_status FROM cfdi_documents
      WHERE credit_note_id = ? AND organization_id = ?
        AND sat_status IN ('draft', 'vigente', 'cancel_pending') LIMIT 1`,
    [creditNoteId, orgId],
  );
  if (rows[0]) {
    throw new AppError(
      `This credit note has a ${rows[0].sat_status} CFDI (#${rows[0].id}) — its amounts are fiscally frozen. ${remedy}`,
      422, 'CFDI_STAMPED',
    );
  }
}

// Every field the CFDI de Egreso freezes. Compared by VALUE, not presence: the
// edit modal re-sends the amounts on every save, so a presence check would 422
// a note-text edit on any stamped credit note.
const FROZEN_FIELDS = ['subtotal', 'tax_amount', 'total', 'tax_rate', 'invoice_id', 'credit_note_number'];
function sameValue(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  const na = Number(a); const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.abs(na - nb) < 0.005;
  return String(a) === String(b);
}

const router = Router();
// The update guard merges the incoming partial body over the existing row so a
// PUT that changes only one amount can't sneak the note inconsistent (or can
// deliberately FIX an inconsistent legacy note).
const ctrl = crudController(CreditNote, {
  beforeUpdate: async (old, req) => {
    assertTotalsConsistent({
      subtotal: req.body.subtotal ?? old.subtotal,
      tax_amount: req.body.tax_amount ?? old.tax_amount,
      total: req.body.total ?? old.total,
    });

    const changed = FROZEN_FIELDS.filter(
      (f) => req.body[f] !== undefined && !sameValue(req.body[f], old[f]),
    );
    if (changed.length === 0) return;

    await assertNoLiveCfdi(old.id, req.orgId,
      'Cancel or substitute the CFDI before changing this credit note.');

    // An edit that STRIPS the tax is the tipo-E twin of the invoice hole closed
    // in #551: a zero-tax egreso stamps ObjetoImp='01' with no impuestos, so it
    // declares the credited operation was not taxable while the ingreso it
    // relates to (TipoRelacion 01) declared tax on the same money. Fires only
    // when the edit REMOVES tax, so an already-untaxed note is never
    // re-examined and an exempt client's zero stays legal.
    const taxAmount = Number(req.body.tax_amount ?? old.tax_amount ?? 0);
    const removesTax = Number(old.tax_amount ?? 0) > 0.005 && taxAmount <= 0.005;
    if (removesTax && old.client_id) {
      await billingService.assertTaxCoherent(db.query.bind(db), {
        orgId: req.orgId, clientId: old.client_id, taxAmount, docType: 'credit note',
      });
    }
  },

  // Delete and restore were as open as update was — a credit note with a live
  // CFDI could be soft-deleted while the egreso stayed filed at SAT.
  beforeDelete: async (old, req) => {
    await assertNoLiveCfdi(old.id, req.orgId,
      'Cancel the CFDI before deleting this credit note.');
  },
  beforeRestore: async (req) => {
    await assertNoLiveCfdi(req.params.id, req.orgId,
      'This credit note has a live CFDI; restoring it would resurrect a row that disagrees with the filed document.');
  },
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('credit_notes.view'), ctrl.list);
router.get('/:id', requirePermission('credit_notes.view'), ctrl.get);
router.post('/', requirePermission('credit_notes.create'), validate(createCreditNote), async (req, res, next) => {
  try {
    assertTotalsConsistent(req.body);
    req.body.organization_id = req.orgId;

    // The resolver was never consulted here. A credit note for a non-exempt MX
    // client with tax 0 satisfied the consistency check above (1160 + 0 = 1160)
    // and stamped as a tipo-E CFDI with ObjetoImp='01' and no impuestos —
    // telling SAT the credited operation was not taxable, while the ingreso it
    // relates to declared IVA on the same money. Both directions, same helper
    // the invoice and quote paths use.
    await billingService.assertTaxCoherent(db.query.bind(db), {
      orgId: req.orgId,
      clientId: req.body.client_id,
      taxAmount: req.body.tax_amount ?? 0,
      docType: 'credit note',
    });
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
