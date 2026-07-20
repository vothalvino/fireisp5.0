// =============================================================================
// FireISP 5.0 — Payment Routes
// =============================================================================

const { Router } = require('express');
const Payment = require('../models/Payment');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPayment, updatePayment, patchPayment, allocatePayment, allocateAuto } = require('../middleware/schemas/payments');
const billingService = require('../services/billingService');
const repService = require('../services/repService');
const { requireMxLocale } = require('../middleware/orgLocale');
const paymentAllocationService = require('../services/paymentAllocationService');
const db = require('../config/database');

const router = Router();
// Keep the client balance ledger in sync with the payment lifecycle. Creating a
// payment writes a 'payment' credit (see the POST handler below); deleting one
// must remove that credit, otherwise the ledger and the computed balance keep
// showing a payment that has vanished from the Payments tab. Restoring re-adds it.
const ctrl = crudController(Payment, {
  afterDelete: async (payment) => {
    await billingService.reversePaymentCredit(payment.id);
    // Also undo its invoice allocations so an invoice isn't left flagged 'paid'
    // while the balance now shows it owed again.
    await billingService.reversePaymentAllocations(payment.id);
  },
  afterRestore: async (payment, req) => {
    await billingService.reversePaymentCredit(payment.id); // idempotent — avoid a double credit
    await billingService.recordPaymentCredit(payment, req.orgId);
    await billingService.restorePaymentAllocations(payment.id);
  },
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payments.view'), ctrl.list);
router.get('/:id', requirePermission('payments.view'), ctrl.get);

// Create a payment and optionally allocate + reconnect
router.post('/', requirePermission('payments.create'), validate(createPayment), async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    // Default to the organization's currency when the caller doesn't send
    // one — otherwise payments.currency's own column default ('USD') would
    // silently win regardless of the org's real currency. An explicitly-set
    // currency in the request always wins.
    if (!req.body.currency) {
      req.body.currency = await Organization.getCurrency(req.orgId);
    }
    const payment = await Payment.create(req.body);

    // Update client balance ledger
    await billingService.recordPaymentCredit(payment, req.orgId);

    res.status(201).json({ data: payment });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('payments.update'), validate(updatePayment), ctrl.update);
router.patch('/:id', requirePermission('payments.update'), validate(patchPayment), ctrl.partialUpdate);
router.delete('/:id', requirePermission('payments.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('payments.update'), ctrl.restore);

// Allocate payment to invoice
router.post('/:id/allocate', requirePermission('payments.create'), validate(allocatePayment), async (req, res, next) => {
  try {
    const { invoice_id, amount } = req.body;

    // Org-verify the payment BEFORE touching anything else. This route used
    // to accept ANY payment id with no organization_id filter at all — an
    // authenticated user in org A could allocate org B's payment to org B's
    // invoice (marking it paid and reconnecting org B's contract) just by
    // guessing/enumerating ids. Mirrors the reallocate/reassign/unapply
    // routes' payment lookup below.
    const [paymentRows] = await db.query(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!paymentRows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }

    // Validate invoice exists (same org — same hole as above: this had no
    // organization_id filter either) and is not void BEFORE inserting the
    // allocation. A voided invoice's total is NOT zeroed on void (only its
    // ledger entries are), so the over-allocation trigger would otherwise
    // still let the apply through.
    const [invoiceRows] = await db.query(
      'SELECT * FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [invoice_id, req.orgId],
    );
    const invoice = invoiceRows[0];
    if (!invoice) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    }
    if (invoice.status === 'void' || invoice.status === 'cancelled') {
      return res.status(422).json({ error: { code: 'INVOICE_NOT_PAYABLE', message: `Cannot apply a payment to a ${invoice.status} invoice.` } });
    }

    let allocation;
    try {
      allocation = await Payment.allocate(req.params.id, invoice_id, amount);
    } catch (allocErr) {
      // Over-allocation guard trigger (SQLSTATE 45000) fires when the amount
      // would exceed the invoice or payment total. Mirror the reallocate handler.
      if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
        return res.status(422).json({
          error: { code: 'OVER_ALLOCATION', message: 'Allocation would exceed the invoice or payment total.' },
        });
      }
      throw allocErr;
    }

    // Mark the invoice paid once fully covered, and reconnect a suspended
    // contract — shared with POST /:id/allocate-auto so the two endpoints
    // cannot drift (see src/services/paymentAllocationService.js).
    const becamePaid = await paymentAllocationService.finalizeIfFullyPaid(db.query.bind(db), invoice);
    if (becamePaid) {
      await paymentAllocationService.reconnectIfSuspended(invoice, req.user.id);
    }

    // MX/SAT: a payment against a vigente PPD CFDI must be reported with a
    // Complemento de Pago (REP). Best-effort AFTER the allocation committed —
    // never fails the payment operation; skipped silently for non-PPD/global.
    const rep = await repService.maybeGenerateRep(parseInt(req.params.id, 10), invoice_id, amount, req.orgId, req.user?.id);

    res.status(201).json({ data: allocation, rep });
  } catch (err) {
    next(err);
  }
});

// Allocate a payment across one or more of the client's open invoices,
// oldest→newest (FIFO waterfall), atomically. This is the endpoint the
// RecordPaymentModal checklist submits to — see PR brief "payment waterfall".
//
// Body: { invoice_ids?: number[] }
//   - given: only those invoices (still org+client verified, still payable,
//     still applied oldest→newest — narrowing the set never changes order).
//   - omitted: ALL of the payment's client's payable open invoices.
//
// Any leftover after the last invoice is covered stays as unallocated credit
// on the payment (today's existing model — nothing new to build there).
router.post('/:id/allocate-auto', requirePermission('payments.create'), validate(allocateAuto), async (req, res, next) => {
  const conn = await db.getConnection();
  let connReleased = false;
  try {
    const paymentId = parseInt(req.params.id, 10);
    const rawInvoiceIds = req.body.invoice_ids;

    // validate()'s 'array' type only confirms the top-level shape; each
    // element is checked here (mirrors deviceGroups.js's addGroupMembers
    // convention where per-item checking also isn't done by validate()).
    let requestedIds = null;
    if (rawInvoiceIds !== undefined) {
      if (!Array.isArray(rawInvoiceIds) || rawInvoiceIds.length === 0
        || rawInvoiceIds.some((v) => !Number.isInteger(v) || v < 1)) {
        return res.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: 'invoice_ids must be a non-empty array of positive integers.' },
        });
      }
      requestedIds = [...new Set(rawInvoiceIds)];
    }

    await conn.beginTransaction();

    // Org-verify + lock the payment for the duration of this allocation.
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL FOR UPDATE',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }
    const payment = payRows[0];

    // Unallocated remainder for THIS payment (live allocations only).
    const [remRows] = await conn.execute(
      'SELECT COALESCE(SUM(amount), 0) AS allocated FROM payment_allocations WHERE payment_id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    let remainder = Math.round((parseFloat(payment.amount) - parseFloat(remRows[0].allocated || 0)) * 100) / 100;
    if (remainder <= 0) {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'PAYMENT_FULLY_ALLOCATED', message: 'This payment has no remaining balance to allocate.' },
      });
    }

    // Target invoices — org + client verified, payable, oldest→newest, locked
    // FOR UPDATE. Shared with GET /clients/:id/open-invoices so the checklist
    // the user saw and the order money is actually applied in always match.
    const invoiceRows = await paymentAllocationService.getInvoicesWithBalance(
      conn.execute.bind(conn), req.orgId, payment.client_id, requestedIds, true,
    );
    if (requestedIds) {
      const foundIds = new Set(invoiceRows.map((r) => r.id));
      const missing = requestedIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        await conn.rollback();
        return res.status(422).json({
          error: {
            code: 'INVOICE_NOT_PAYABLE',
            message: `Invoice id(s) ${missing.join(', ')} are not payable invoices for this payment's client.`,
          },
        });
      }
    }

    const allocations = [];
    const justPaidInvoices = [];
    for (const invoice of invoiceRows) {
      if (remainder <= 0) break;

      const balanceDue = Math.max(0, Math.round(Number(invoice.balance_due) * 100) / 100);
      if (balanceDue <= 0) continue; // already fully covered — skip, don't insert a zero row

      const applyAmount = Math.round(Math.min(remainder, balanceDue) * 100) / 100;
      if (applyAmount <= 0) continue;

      let insertResult;
      try {
        [insertResult] = await conn.execute(
          'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
          [paymentId, invoice.id, applyAmount],
        );
      } catch (allocErr) {
        // Over-allocation guard trigger (migration 126) → SQLSTATE 45000.
        if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
          await conn.rollback();
          return res.status(422).json({
            error: { code: 'OVER_ALLOCATION', message: 'Allocation would exceed the invoice or payment total.' },
          });
        }
        // The soft-delete-aware UNIQUE (migration 361) rejects a second live
        // allocation of this SAME payment to this SAME invoice — e.g.
        // allocate-auto called twice with overlapping invoice_ids. Skip
        // rather than fail the whole batch; the earlier live allocation
        // already covers this invoice from this payment.
        if (allocErr.code === 'ER_DUP_ENTRY' || allocErr.errno === 1062) {
          continue;
        }
        throw allocErr;
      }

      allocations.push({
        id: insertResult.insertId, payment_id: paymentId, invoice_id: invoice.id,
        invoice_number: invoice.invoice_number, amount: applyAmount,
      });
      remainder = Math.round((remainder - applyAmount) * 100) / 100;

      const becamePaid = await paymentAllocationService.finalizeIfFullyPaid(conn.execute.bind(conn), invoice);
      if (becamePaid) justPaidInvoices.push(invoice);
    }

    await conn.commit();

    // Reconnect side effects run AFTER commit — reconnectContract opens its
    // own connection/transaction and cannot join this one (see
    // paymentAllocationService.reconnectIfSuspended).
    for (const invoice of justPaidInvoices) {
      await paymentAllocationService.reconnectIfSuspended(invoice, req.user.id);
    }

    // Release the transaction connection BEFORE the REP/PAC work: stamping is
    // slow external I/O and must not hold a pool slot (pool exhaustion under
    // PAC latency). The transaction is already committed.
    conn.release();
    connReleased = true;

    // REP per allocation (see the single-allocate hook). One REP per
    // (payment, invoice) pair — multiple REPs for one payment are SAT-valid.
    const reps = [];
    for (const a of allocations) {
      reps.push(await repService.maybeGenerateRep(paymentId, a.invoice_id, a.amount, req.orgId, req.user?.id));
    }

    const paidIds = new Set(justPaidInvoices.map((inv) => inv.id));
    const enrichedAllocations = allocations.map((a) => ({ ...a, fully_paid: paidIds.has(a.invoice_id) }));

    res.status(201).json({ data: { allocations: enrichedAllocations, remaining_credit: remainder }, reps });
  } catch (err) {
    if (!connReleased) await conn.rollback().catch(() => {});
    next(err);
  } finally {
    if (!connReleased) conn.release();
  }
});

// Manual REP (Complemento de Pago) generation — for allocations made before
// the automation existed, or after an auto-attempt failed pre-creation.
// The invoice must have a vigente PPD CFDI; amount = the live allocation.
router.post('/:id/rep', requireMxLocale, requirePermission('cfdi_documents.create'), async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const invoiceId = parseInt(req.body?.invoice_id, 10);
    if (!invoiceId) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'invoice_id is required.' } });
    }
    const [allocRows] = await db.query(
      `SELECT pa.amount FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id AND p.organization_id = ? AND p.deleted_at IS NULL
        WHERE pa.payment_id = ? AND pa.invoice_id = ? AND pa.deleted_at IS NULL LIMIT 1`,
      [req.orgId, paymentId, invoiceId],
    );
    if (!allocRows[0]) {
      return res.status(422).json({ error: { code: 'ALLOCATION_NOT_FOUND', message: 'This payment is not applied to that invoice.' } });
    }
    const result = await repService.generateRepForAllocation(paymentId, invoiceId, allocRows[0].amount, req.orgId, req.user?.id);
    if (!result.generated) {
      const REASONS = {
        NO_PPD_CFDI: 'the invoice needs a vigente PPD CFDI (PUE invoices are covered by their own CFDI).',
        NON_MXN: 'the payment is not in MXN — REPs apply to MXN payments only.',
        PAYMENT_NOT_SETTLED: 'the payment is not settled (failed/refunded/cancelled payments are never REP-reported).',
        CFDI_FULLY_REPORTED: 'the invoice CFDI is already fully covered by prior REPs.',
        REP_ALREADY_EXISTS: `a live REP (#${result.cfdi_document_id}) already covers this allocation.`,
      };
      const status = result.reason === 'REP_ALREADY_EXISTS' ? 409 : 422;
      return res.status(status).json({ error: { code: `REP_${result.reason}`, message: `No REP generated: ${REASONS[result.reason] || result.reason}` } });
    }
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Get payment allocations
router.get('/:id/allocations', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const allocations = await Payment.getAllocations(req.params.id);
    res.json({ data: allocations });
  } catch (err) {
    next(err);
  }
});

// Thermal receipt — plain-text monospaced format for 58mm or 80mm printers
router.get('/:id/receipt', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const thermalReceiptService = require('../services/thermalReceiptService');
    const widthStr = req.query.width;
    const width = widthStr === '58' ? 32 : 48;
    const text = await thermalReceiptService.generatePaymentThermalReceipt(
      parseInt(req.params.id, 10),
      { width },
    );
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    next(err);
  }
});

// Reallocate a payment from one invoice to another (SAME CLIENT ONLY).
// Body: { from_invoice_id, to_invoice_id, amount? }
// amount defaults to the existing allocation's amount if omitted.
// Both invoices must belong to the same client as the payment.
// The DB over-allocation trigger fires on the new INSERT — surfaces as 422.
router.post('/:id/reallocate', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  let connReleased = false;
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { from_invoice_id, to_invoice_id, amount: amountParam } = req.body;

    if (!from_invoice_id || !to_invoice_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'from_invoice_id and to_invoice_id are required.' },
      });
    }
    if (Number(from_invoice_id) === Number(to_invoice_id)) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'from_invoice_id and to_invoice_id must differ.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }
    const payment = payRows[0];

    // Load the live allocation from → invoice
    const [allocRows] = await conn.execute(
      'SELECT * FROM payment_allocations WHERE payment_id = ? AND invoice_id = ? AND deleted_at IS NULL LIMIT 1',
      [paymentId, from_invoice_id],
    );
    if (!allocRows[0]) {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'ALLOCATION_NOT_FOUND', message: 'This payment has no live allocation to from_invoice_id.' },
      });
    }
    const existingAlloc = allocRows[0];
    const moveAmount = amountParam !== null && amountParam !== undefined ? parseFloat(amountParam) : parseFloat(existingAlloc.amount);

    // Validate both invoices belong to the payment's client
    const [invRows] = await conn.execute(
      'SELECT id, client_id, status FROM invoices WHERE id IN (?, ?) AND deleted_at IS NULL',
      [from_invoice_id, to_invoice_id],
    );
    const fromInv = invRows.find(r => r.id === from_invoice_id || r.id === Number(from_invoice_id));
    const toInv   = invRows.find(r => r.id === to_invoice_id   || r.id === Number(to_invoice_id));

    if (!fromInv) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'from_invoice_id not found.' } });
    }
    if (!toInv) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'to_invoice_id not found.' } });
    }
    // Reallocating TO a void/cancelled invoice makes no sense — it owes nothing.
    // Reallocating AWAY from such an invoice (from_invoice) is allowed.
    if (toInv.status === 'void' || toInv.status === 'cancelled') {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'INVOICE_NOT_PAYABLE', message: `Cannot reallocate a payment to a ${toInv.status} invoice.` },
      });
    }
    if (Number(toInv.client_id) !== Number(payment.client_id)) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'CROSS_CLIENT_REALLOCATION',
          message: 'to_invoice_id belongs to a different client. Reassign the payment to that client first.',
        },
      });
    }
    if (Number(fromInv.client_id) !== Number(payment.client_id)) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'CROSS_CLIENT_REALLOCATION',
          message: 'from_invoice_id belongs to a different client than this payment.',
        },
      });
    }

    // Soft-delete the old allocation
    await conn.execute(
      'UPDATE payment_allocations SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [existingAlloc.id],
    );

    // Insert the new allocation — DB trigger enforces over-allocation caps
    let newAllocId;
    try {
      const [insertResult] = await conn.execute(
        'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
        [paymentId, to_invoice_id, moveAmount],
      );
      newAllocId = insertResult.insertId;
    } catch (allocErr) {
      // Over-allocation guard trigger (migration 126/370) raises SQLSTATE 45000.
      if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
        await conn.rollback();
        return res.status(422).json({
          error: { code: 'OVER_ALLOCATION', message: 'Allocation would exceed the invoice or payment total.' },
        });
      }
      // The soft-delete-aware UNIQUE (migration 361) rejects a SECOND live
      // allocation of this payment to the same invoice.
      if (allocErr.code === 'ER_DUP_ENTRY' || allocErr.errno === 1062) {
        await conn.rollback();
        return res.status(422).json({
          error: { code: 'ALLOCATION_EXISTS', message: 'This payment is already applied to that invoice.' },
        });
      }
      throw allocErr; // unexpected/infra error — outer catch rolls back + 500s
    }

    await conn.commit();
    // Committed — release the pool slot before the slow post-commit work
    // (status refreshes + REP/PAC I/O must not hold a connection).
    conn.release();
    connReleased = true;

    // Re-derive paid status for both invoices (outside the transaction — reads committed state)
    await billingService.refreshInvoicePaidStatus(from_invoice_id);
    await billingService.refreshInvoicePaidStatus(to_invoice_id);

    // REP for the NEW allocation (the moved-from invoice's REP, if any, stays
    // on record — correcting it is a manual SAT cancellation of that REP).
    await repService.maybeGenerateRep(paymentId, to_invoice_id, moveAmount, req.orgId, req.user?.id);

    const [newAllocRows] = await db.query('SELECT * FROM payment_allocations WHERE id = ?', [newAllocId]);
    res.status(201).json({ data: newAllocRows[0] });
  } catch (err) {
    if (!connReleased) await conn.rollback().catch(() => {});
    next(err);
  } finally {
    if (!connReleased) conn.release();
  }
});

// Reassign a payment to a different client (ONLY IF UNALLOCATED).
// Body: { new_client_id }
// The payment must have NO live payment_allocations. Callers must un-apply first.
// Moves the ledger credit from the old client to the new client atomically.
router.post('/:id/reassign', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { new_client_id } = req.body;

    if (!new_client_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'new_client_id is required.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }
    const payment = payRows[0];

    // Validate new client exists in this org
    const [clientRows] = await conn.execute(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [new_client_id, req.orgId],
    );
    if (!clientRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'new_client_id not found in this organization.' } });
    }

    // Reject if there are live allocations. NOTE: this read is not FOR UPDATE and
    // the apply path (POST /:id/allocate) is non-transactional, so a precisely
    // concurrent allocate could slip in between this check and the commit. That is
    // an accepted limitation for this single-tenant admin tool (two simultaneous
    // admin actions on the same unallocated payment; manually recoverable).
    const [allocCheck] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM payment_allocations WHERE payment_id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    if (Number(allocCheck[0].cnt) > 0) {
      await conn.rollback();
      return res.status(422).json({
        error: {
          code: 'PAYMENT_ALLOCATED',
          message: 'Un-apply this payment from its invoice(s) before reassigning it to another client.',
        },
      });
    }

    // Reverse the old client's ledger credit
    await conn.execute(
      'DELETE FROM client_balance_ledger WHERE reference_type = ? AND reference_id = ?',
      ['payment', paymentId],
    );

    // Move the payment to the new client
    await conn.execute(
      'UPDATE payments SET client_id = ? WHERE id = ?',
      [new_client_id, paymentId],
    );

    // Record the credit for the new client. payments.currency is NOT NULL so
    // the org-currency fallback should never fire — but never default 'USD'.
    const ledgerCurrency = payment.currency || await Organization.getCurrency(req.orgId);
    await conn.execute(
      `INSERT INTO client_balance_ledger
         (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'credit', ?, ?, 'payment', ?, ?)`,
      [
        new_client_id, req.orgId,
        payment.amount, ledgerCurrency,
        paymentId, 'Payment ' + (payment.reference_number || paymentId),
      ],
    );

    await conn.commit();

    // Return the updated payment
    const [updatedRows] = await db.query(
      'SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    res.json({ data: updatedRows[0] });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// Un-apply (de-allocate) a payment from a specific invoice.
// Body: { invoice_id }
// Soft-deletes the live payment_allocation so the payment becomes an
// unallocated credit on the same client. The payment's ledger 'payment'
// credit is NOT touched — only the invoice link is removed.
// billingService.refreshInvoicePaidStatus reverts the invoice paid→issued
// if no other allocations still cover it.
router.post('/:id/unapply', requirePermission('payments.update'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'invoice_id is required.' },
      });
    }

    await conn.beginTransaction();

    // Load payment (org-scoped)
    const [payRows] = await conn.execute(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [paymentId, req.orgId],
    );
    if (!payRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }

    // Find the live allocation for this payment + invoice pair
    const [allocRows] = await conn.execute(
      'SELECT * FROM payment_allocations WHERE payment_id = ? AND invoice_id = ? AND deleted_at IS NULL LIMIT 1',
      [paymentId, invoice_id],
    );
    if (!allocRows[0]) {
      await conn.rollback();
      return res.status(422).json({
        error: { code: 'ALLOCATION_NOT_FOUND', message: 'This payment is not applied to that invoice.' },
      });
    }

    // Soft-delete the allocation
    await conn.execute(
      'UPDATE payment_allocations SET deleted_at = NOW() WHERE id = ?',
      [allocRows[0].id],
    );

    await conn.commit();

    // Re-derive paid status for the invoice (outside the transaction — reads committed state).
    // This reverts the invoice paid→issued if no longer fully covered.
    await billingService.refreshInvoicePaidStatus(invoice_id);

    res.json({ data: { payment_id: paymentId, invoice_id: Number(invoice_id), unapplied: true } });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// Send payment receipt PDF via email
router.post('/:id/send-receipt', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const pdfService = require('../services/pdfService');
    const emailTransport = require('../services/emailTransport');

    // Fetch payment with client info
    const [rows] = await db.query(
      `SELECT p.*, cl.name, cl.email AS client_email,
              o.name AS org_name
       FROM payments p
       LEFT JOIN clients cl ON cl.id = p.client_id
       LEFT JOIN organizations o ON o.id = cl.organization_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [paymentId],
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (!payment.client_email) return res.status(422).json({ error: 'Client has no email address' });

    const locale = req.query.locale || 'en';
    const buffer = await pdfService.generatePaymentReceiptPdf(paymentId, { locale });

    const templates = require('../views/emailTemplates');
    const template = templates.paymentReceiptEmail({
      clientName: payment.name || '',
      orgName: payment.org_name,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.payment_method,
      reference: payment.reference_number || payment.reference,
      paymentDate: payment.payment_date
        ? new Date(payment.payment_date).toISOString().slice(0, 10)
        : undefined,
    });

    const result = await emailTransport.sendEmail({
      organizationId: req.orgId,
      emailFunction: 'billing',
      to: payment.client_email,
      subject: template.subject,
      html: template.html,
      attachments: [{ filename: `receipt-${paymentId}.pdf`, content: buffer }],
    });
    if (!result.success) {
      return res.status(502).json({ error: result.error || 'Failed to send receipt' });
    }

    res.json({ message: 'Receipt sent', to: payment.client_email });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
