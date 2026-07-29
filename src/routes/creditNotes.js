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
// `exec` runs this on the caller's transaction. Under transactionalWrites a
// db.query here would acquire a SECOND pooled connection while the first is
// held — the nested-acquire hang fixed in #584 — and would also be reading
// outside the lock, which defeats the guard.
async function assertNoLiveCfdi(creditNoteId, orgId, remedy, exec = db.query) {
  const [rows] = await exec(
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
  // The guards below decide from rows a concurrent request can change — above
  // all whether a live CFDI exists. Without the lock they are advisory: a stamp
  // landing between the check and the UPDATE means the edit applies to a
  // document already filed with SAT. Credit notes had NO lock at all, so the
  // stamper was not serialized against the editor even in principle.
  transactionalWrites: true,
  beforeUpdate: async (old, req, exec) => {
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
      'Cancel or substitute the CFDI before changing this credit note.', exec);

    // An edit that STRIPS the tax is the tipo-E twin of the invoice hole closed
    // in #551: a zero-tax egreso stamps ObjetoImp='01' with no impuestos, so it
    // declares the credited operation was not taxable while the ingreso it
    // relates to (TipoRelacion 01) declared tax on the same money. Fires only
    // when the edit REMOVES tax, so an already-untaxed note is never
    // re-examined and an exempt client's zero stays legal.
    const taxAmount = Number(req.body.tax_amount ?? old.tax_amount ?? 0);
    const removesTax = Number(old.tax_amount ?? 0) > 0.005 && taxAmount <= 0.005;
    if (removesTax && old.client_id) {
      // exec, not db.query: see the note on assertNoLiveCfdi above.
      await billingService.assertTaxCoherent(exec, {
        orgId: req.orgId, clientId: old.client_id, taxAmount, docType: 'credit note',
      });
    }
  },

  // Delete and restore were as open as update was — a credit note with a live
  // CFDI could be soft-deleted while the egreso stayed filed at SAT.
  beforeDelete: async (old, req, exec) => {
    // exec, not the default: the guard must read inside the row lock, or a
    // stamp landing between the check and the soft-delete leaves a deleted note
    // whose egreso is vigente at SAT.
    await assertNoLiveCfdi(old.id, req.orgId,
      'Cancel the CFDI before deleting this credit note.', exec);
  },
  beforeRestore: async (req, exec) => {
    await assertNoLiveCfdi(req.params.id, req.orgId,
      'This credit note has a live CFDI; restoring it would resurrect a row that disagrees with the filed document.', exec);
  },
});

router.use(authenticate);
router.use(orgScope);

/**
 * Attach each row's CFDI state to a page of credit notes.
 *
 * The list returned unaliased credit_notes columns and nothing else, so the UI
 * had no way to know a note was already stamped — it kept offering Stamp, and
 * the click came back 409. The same statuses assertNoLiveCfdi treats as live
 * count here, so the button disappears exactly when the stamp route would
 * refuse: `cfdi_sat_status` is null when there is no live CFDI.
 *
 * One query for the whole page, and the placeholders are built by hand —
 * `IN (?)` does NOT expand to a list under this execute-backed db.query, it
 * binds the array as a single value and silently matches nothing.
 */
async function attachCfdiState(orgId, rows) {
  const ids = rows.map(r => r.id).filter(id => id !== null && id !== undefined);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  const [cfdis] = await db.query(
    `SELECT credit_note_id, id, uuid, sat_status FROM cfdi_documents
      WHERE organization_id = ? AND credit_note_id IN (${placeholders})
        AND sat_status IN ('draft', 'vigente', 'cancel_pending')`,
    [orgId, ...ids],
  );
  const byNote = new Map();
  for (const c of cfdis) byNote.set(String(c.credit_note_id), c);
  for (const row of rows) {
    const c = byNote.get(String(row.id)) || null;
    row.cfdi_document_id = c ? c.id : null;
    row.cfdi_uuid = c ? c.uuid : null;
    row.cfdi_sat_status = c ? c.sat_status : null;
  }
}

router.get('/', requirePermission('credit_notes.view'), (req, res, next) => {
  // ctrl.list owns the filtering, pagination and org scoping; intercept its
  // payload rather than reimplementing all of that for one extra field.
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    const rows = Array.isArray(payload?.data) ? payload.data : null;
    if (!rows || rows.length === 0) return sendJson(payload);
    attachCfdiState(req.orgId, rows).then(() => sendJson(payload)).catch(next);
    return res;
  };
  return ctrl.list(req, res, next);
});
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
