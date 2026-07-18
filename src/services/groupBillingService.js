// =============================================================================
// FireISP 5.0 — Client-Group Shared Billing Service
// =============================================================================
// A client_group with billing_mode='shared' has a designated primary member.
// This service lets that primary VIEW the group's combined balance and PAY it
// on behalf of every member.
//
// Design (see PR): members keep their OWN invoices and balances — each member
// stays their own invoice recipient, which is correct for CFDI (the member's
// RFC is the receptor). "Shared" does NOT reassign invoices to the primary.
// Instead a group payment is a SINGLE payment recorded on the primary that is
// FIFO-allocated across the group's open invoices (all members, oldest→newest,
// the same waterfall order the per-client allocate-auto uses). Because a
// client's balance is computed allocation-aware on the INVOICE side
// (clientBalanceService), settling a member's invoice from the primary's
// payment correctly zeroes that member's balance, and a fully-allocated
// payment leaves no phantom credit on the primary. Any overpayment remains as
// ordinary unallocated credit on the primary.
//
// Cross-client allocation (primary's payment → a member's invoice) is scoped
// strictly to members of the SAME shared group here; the manual per-payment
// allocate/reallocate/reassign routes keep their same-client guards untouched.
// =============================================================================

const db = require('../config/database');
const ClientGroup = require('../models/ClientGroup');
const Organization = require('../models/Organization');
const { computeClientBalance } = require('./clientBalanceService');
const paymentAllocationService = require('./paymentAllocationService');
const { ValidationError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'groupBilling' });

/**
 * Write client_balance_ledger 'credit' rows for a group payment, allocation-
 * aware: one credit per member for the amount actually applied to that
 * member's invoices, plus the unallocated remainder credited to the primary.
 * The sum equals the payment amount, so the ledger nets out per client the
 * same way a normal same-client payment does. reference_type/id = the payment,
 * so a payment delete (billingService.reversePaymentCredit) still removes them.
 */
async function writeGroupLedgerCredits({ orgId, paymentId, currency, settled, primaryId, totalAmount, allocatedTotal }) {
  const byClient = new Map();
  for (const a of settled) {
    byClient.set(a.client_id, Math.round(((byClient.get(a.client_id) || 0) + a.amount) * 100) / 100);
  }
  const remainder = Math.round((totalAmount - allocatedTotal) * 100) / 100;
  if (remainder > 0.005) {
    byClient.set(primaryId, Math.round(((byClient.get(primaryId) || 0) + remainder) * 100) / 100);
  }
  for (const [clientId, amount] of byClient) {
    if (amount <= 0.005) continue;
    await db.query(
      `INSERT INTO client_balance_ledger (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'credit', ?, ?, 'payment', ?, ?)`,
      [clientId, orgId, amount, currency, paymentId, `Group payment ${paymentId}`],
    );
  }
}

/**
 * Load a shared group + its members, or throw. Returns { group, memberIds,
 * primaryId }. 404 when the group doesn't exist in this org; 422 when it is
 * not a shared-billing group or has no primary member designated.
 */
async function loadSharedGroup(orgId, groupId) {
  const group = await ClientGroup.findById(groupId, orgId);
  if (!group) throw new NotFoundError('Client group');
  if (group.billing_mode !== 'shared') {
    throw new ValidationError('This group is not a shared-billing group. Set its billing mode to "shared" and designate a primary member first.');
  }
  if (!group.primary_client_id) {
    throw new ValidationError('This shared group has no primary member designated. Set a primary member before billing the group.');
  }
  const members = await ClientGroup.getMembers(groupId, orgId);
  const memberIds = members.map((m) => Number(m.id));
  if (!memberIds.includes(Number(group.primary_client_id))) {
    // The primary must actually belong to the group it's the billing owner of.
    throw new ValidationError('The designated primary member does not belong to this group.');
  }
  return { group, members, memberIds, primaryId: Number(group.primary_client_id) };
}

/**
 * The group's combined billing picture: each member's balance, the group
 * total, and the merged list of open invoices (oldest→newest — the order a
 * group payment settles them in).
 */
async function getGroupBilling(orgId, groupId) {
  const { group, members, primaryId } = await loadSharedGroup(orgId, groupId);

  const memberBalances = [];
  const openInvoices = [];
  for (const member of members) {
    const { balance, currency } = await computeClientBalance(orgId, member.id);
    memberBalances.push({
      client_id: Number(member.id),
      name: member.name,
      is_primary: Number(member.id) === primaryId,
      balance,
      currency,
    });
    const invs = await paymentAllocationService.getInvoicesWithBalance(db.query.bind(db), orgId, member.id, null, false);
    for (const inv of invs) {
      const balanceDue = Math.round(Number(inv.balance_due) * 100) / 100;
      if (balanceDue > 0.005) {
        openInvoices.push({
          invoice_id: Number(inv.id),
          invoice_number: inv.invoice_number,
          client_id: Number(inv.client_id),
          client_name: member.name,
          issue_date: inv.issue_date,
          balance_due: balanceDue,
          currency: inv.currency,
        });
      }
    }
  }
  // Merge FIFO across the whole group (oldest issue_date first, id tiebreak).
  openInvoices.sort((a, b) => {
    const da = new Date(a.issue_date).getTime();
    const dbb = new Date(b.issue_date).getTime();
    return da !== dbb ? da - dbb : a.invoice_id - b.invoice_id;
  });

  const groupBalance = Math.round(memberBalances.reduce((s, m) => s + m.balance, 0) * 100) / 100;
  // Settlement currency = the single currency of the open invoices if they
  // agree, else the org currency (one-per-org). payable_total is the amount a
  // group payment would actually settle — the settlement-currency invoices —
  // NOT a meaningless cross-currency sum. Legacy foreign invoices are exposed
  // separately so the UI can note them without blocking payment.
  const invoiceCurrencies = new Set(openInvoices.map((i) => i.currency));
  const groupCurrency = invoiceCurrencies.size === 1
    ? [...invoiceCurrencies][0]
    : await Organization.getCurrency(orgId);
  const payableTotal = Math.round(
    openInvoices.filter((i) => i.currency === groupCurrency).reduce((s, i) => s + i.balance_due, 0) * 100,
  ) / 100;

  return {
    group: { id: Number(group.id), name: group.name, billing_mode: group.billing_mode, primary_client_id: primaryId },
    members: memberBalances,
    open_invoices: openInvoices,
    group_balance: groupBalance,
    group_currency: groupCurrency,
    payable_total: payableTotal,
    other_currency_invoices: openInvoices.filter((i) => i.currency !== groupCurrency),
  };
}

/**
 * Pay the group's balance on behalf of its members. Creates one payment on the
 * primary and FIFO-allocates it across the group's open invoices.
 *
 * @param {number} orgId
 * @param {number} groupId
 * @param {object} opts
 * @param {number} [opts.amount]          - amount to pay; omitted = full payable total
 * @param {string} [opts.payment_method]
 * @param {string} [opts.reference_number]
 * @param {number[]} [opts.invoice_ids]   - restrict to a subset of the group's open invoices
 * @param {number} [opts.actorUserId]
 * @returns {Promise<object>} settlement summary
 */
async function payGroup(orgId, groupId, opts = {}) {
  // Validate the group OUTSIDE the transaction (cheap, clear errors).
  const { primaryId, memberIds } = await loadSharedGroup(orgId, groupId);

  let requestedIds = null;
  if (opts.invoice_ids !== undefined) {
    if (!Array.isArray(opts.invoice_ids) || opts.invoice_ids.length === 0
      || opts.invoice_ids.some((v) => !Number.isInteger(v) || v < 1)) {
      throw new ValidationError('invoice_ids must be a non-empty array of positive integers.');
    }
    requestedIds = new Set(opts.invoice_ids);
  }

  const conn = await db.getConnection();
  let payment;
  // Assigned inside the transaction before the (post-commit) return reads it.
  let skippedOtherCurrency;
  const settled = [];
  const justPaidInvoices = [];
  try {
    await conn.beginTransaction();

    // Gather the group's open invoices, locked, oldest→newest across members.
    let invoiceRows = [];
    for (const memberId of memberIds) {
      const rows = await paymentAllocationService.getInvoicesWithBalance(conn.execute.bind(conn), orgId, memberId, null, true);
      invoiceRows.push(...rows);
    }
    invoiceRows.sort((a, b) => {
      const da = new Date(a.issue_date).getTime();
      const dbb = new Date(b.issue_date).getTime();
      return da !== dbb ? da - dbb : a.id - b.id;
    });
    if (requestedIds) {
      const available = new Set(invoiceRows.map((r) => Number(r.id)));
      const missing = [...requestedIds].filter((id) => !available.has(id));
      if (missing.length) {
        await conn.rollback();
        throw new ValidationError(`Invoice id(s) ${missing.join(', ')} are not open invoices for this group.`);
      }
      invoiceRows = invoiceRows.filter((r) => requestedIds.has(Number(r.id)));
    }

    // A single payment can't honestly settle invoices in different currencies
    // (there is no conversion here). FireISP currency is one-per-org, so a
    // group's real invoices all share the org currency — but LEGACY invoices
    // in a foreign currency may still exist as historical data. Rather than
    // dead-ending the whole payment on those, settle the SETTLEMENT-currency
    // invoices (the single shared currency if the payable set agrees, else the
    // org currency) and skip any foreign-currency legacy ones (reported back,
    // not silently dropped). The payment is denominated in that currency.
    const payableRows = invoiceRows.filter((inv) => Math.round(Number(inv.balance_due) * 100) / 100 > 0);
    const currencies = new Set(payableRows.map((inv) => inv.currency));
    const currency = currencies.size === 1 ? [...currencies][0] : await Organization.getCurrency(orgId);

    skippedOtherCurrency = payableRows
      .filter((inv) => inv.currency !== currency)
      .map((inv) => ({ invoice_id: Number(inv.id), invoice_number: inv.invoice_number, currency: inv.currency, balance_due: Math.round(Number(inv.balance_due) * 100) / 100 }));
    if (requestedIds && skippedOtherCurrency.length) {
      // If the caller explicitly asked for invoices, a currency mismatch is
      // their error to fix, not something to silently skip.
      await conn.rollback();
      throw new ValidationError(`Selected invoice(s) span more than one currency; settle ${currency} invoices separately.`);
    }
    // Only settlement-currency invoices are eligible for allocation.
    invoiceRows = invoiceRows.filter((inv) => inv.currency === currency);

    const payableTotal = Math.round(
      invoiceRows.reduce((s, inv) => s + Math.max(0, Math.round(Number(inv.balance_due) * 100) / 100), 0) * 100,
    ) / 100;

    // Amount: default to the full payable total. A caller amount is capped at
    // nothing here — an overpayment simply leaves unallocated credit on the
    // primary (ordinary payment behavior), but a zero/negative amount is invalid.
    const amount = opts.amount !== undefined ? Math.round(Number(opts.amount) * 100) / 100 : payableTotal;
    if (!(amount > 0)) {
      await conn.rollback();
      throw new ValidationError(payableTotal <= 0
        ? 'This group has no open balance to pay.'
        : 'Payment amount must be greater than zero.');
    }

    // Create the payment on the PRIMARY, inside the transaction.
    const [payResult] = await conn.execute(
      `INSERT INTO payments (organization_id, client_id, amount, currency, payment_method, payment_date, reference_number, status, notes)
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?, 'completed', ?)`,
      [
        orgId, primaryId, amount, currency,
        opts.payment_method || 'other',
        opts.reference_number || null,
        `Group payment for group #${groupId} (settles member balances)`,
      ],
    );
    const paymentId = payResult.insertId;

    // FIFO-allocate down the merged group invoice list.
    let remainder = amount;
    for (const invoice of invoiceRows) {
      if (remainder <= 0.005) break;
      const balanceDue = Math.max(0, Math.round(Number(invoice.balance_due) * 100) / 100);
      if (balanceDue <= 0) continue;
      const applyAmount = Math.round(Math.min(remainder, balanceDue) * 100) / 100;
      if (applyAmount <= 0) continue;

      try {
        await conn.execute(
          'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
          [paymentId, invoice.id, applyAmount],
        );
      } catch (allocErr) {
        if (allocErr.sqlState === '45000' || allocErr.errno === 1644) {
          await conn.rollback();
          throw new ValidationError('Allocation would exceed an invoice or the payment total.');
        }
        if (allocErr.code === 'ER_DUP_ENTRY' || allocErr.errno === 1062) continue;
        throw allocErr;
      }

      remainder = Math.round((remainder - applyAmount) * 100) / 100;
      settled.push({
        invoice_id: Number(invoice.id),
        invoice_number: invoice.invoice_number,
        client_id: Number(invoice.client_id),
        amount: applyAmount,
      });
      const becamePaid = await paymentAllocationService.finalizeIfFullyPaid(conn.execute.bind(conn), invoice);
      if (becamePaid) justPaidInvoices.push(invoice);
    }

    await conn.commit();
    payment = {
      id: paymentId, client_id: primaryId, amount, currency,
      payment_method: opts.payment_method || 'other', reference_number: opts.reference_number || null,
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* already rolled back */ }
    throw err;
  } finally {
    conn.release();
  }

  const allocatedTotal = Math.round(settled.reduce((s, a) => s + a.amount, 0) * 100) / 100;

  // Post-commit side effects (own connections) — mirror allocate-auto.
  // Ledger credits are written ALLOCATION-AWARE, not lumped on the primary: a
  // normal same-client payment's credit offsets that client's invoice debit on
  // one ledger, but here the primary's payment settles MEMBERS' invoices, so
  // the credit must land on each member (the amount applied to their invoices)
  // — else members' statements show a paid invoice as still owed and the
  // primary's statement shows a phantom standing credit. The remainder
  // (overpayment) is credited to the primary as ordinary unallocated credit.
  // (The headline balance is computed from invoices+payments, not the ledger,
  // so it is already correct regardless — this keeps the statement PDF /
  // ledger views consistent too.)
  try {
    await writeGroupLedgerCredits({
      orgId, paymentId: payment.id, currency: payment.currency,
      settled, primaryId, totalAmount: payment.amount, allocatedTotal,
    });
  } catch (err) {
    logger.warn({ err, paymentId: payment.id }, 'group ledger credit write failed (ledger only; computed balance unaffected)');
  }
  for (const invoice of justPaidInvoices) {
    try {
      await paymentAllocationService.reconnectIfSuspended(invoice, opts.actorUserId);
    } catch (err) {
      logger.warn({ err, invoiceId: invoice.id }, 'reconnectIfSuspended failed after group payment');
    }
  }

  logger.info({ groupId, paymentId: payment.id, amount: payment.amount, allocatedTotal, settledCount: settled.length }, 'Group payment settled');

  return {
    payment,
    allocated_total: allocatedTotal,
    unallocated_credit: Math.round((payment.amount - allocatedTotal) * 100) / 100,
    settled_invoices: settled,
    fully_paid_count: justPaidInvoices.length,
    // Legacy foreign-currency invoices left untouched (settle them separately).
    skipped_other_currency: skippedOtherCurrency,
  };
}

module.exports = { getGroupBilling, payGroup, loadSharedGroup };
