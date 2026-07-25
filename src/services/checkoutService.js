// =============================================================================
// FireISP 5.0 — Checkout / Payment Flow Service
// =============================================================================
// Handles payment link generation, checkout sessions, and auto-charge
// for recurring payment profiles.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const paymentGatewayService = require('./paymentGatewayService');
const paymentRetryService = require('./paymentRetryService');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

/** Return `url` only if it is same-origin as `base` (anti open-redirect); else null. */
function sameOriginUrl(url, base) {
  if (!url) return null;
  try {
    return new URL(url).origin === new URL(base).origin ? url : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Create a checkout session for a specific invoice.
 * Returns a payment link or redirect URL.
 */
async function createCheckoutSession({ organizationId, invoiceId, clientId, returnUrl }) {
  // Get the invoice
  const [invoices] = await db.query(
    'SELECT * FROM invoices WHERE id = ? AND organization_id = ?',
    [invoiceId, organizationId],
  );
  if (invoices.length === 0) throw new Error('Invoice not found');

  const invoice = invoices[0];
  // Only payable invoices — never capture money for an invoice that can't be
  // settled (paid/void/cancelled/draft/refunded). reconcilePayment can only mark
  // an issued/sent invoice paid.
  const NON_PAYABLE = ['paid', 'void', 'cancelled', 'draft', 'refunded'];
  if (NON_PAYABLE.includes(invoice.status)) {
    throw new ValidationError(`Invoice ${invoice.invoice_number} cannot be paid online (status: ${invoice.status})`);
  }

  // Resolve the organization's payment gateway: prefer the default, otherwise
  // fall back to the first active gateway. payment_transactions.payment_gateway_id
  // is NOT NULL, so a missing gateway is a client-fixable configuration error (422),
  // not a 500.
  const [gateways] = await db.query(
    `SELECT id, provider, secret_key_encrypted FROM payment_gateways
     WHERE organization_id = ? AND status = 'active'
     ORDER BY is_default DESC, id ASC
     LIMIT 1`,
    [organizationId],
  );
  if (gateways.length === 0) {
    throw new ValidationError('No active payment gateway is configured for this organization');
  }
  const gateway = gateways[0];
  const resolvedClientId = clientId || invoice.client_id;
  // Defense-in-depth: the invoice must belong to the client being charged (the
  // portal route already scopes by req.client.id, but the staff route forwards a
  // raw client_id). Never attribute a payment to a client who doesn't own the invoice.
  if (clientId && Number(invoice.client_id) !== Number(clientId)) {
    throw new ValidationError('Invoice does not belong to this client');
  }
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Stripe: create a REAL hosted Checkout Session and redirect the client to it.
  // The pending transaction stores the session id (cs_...) as its gateway
  // reference so the checkout.session.completed webhook reconciles it.
  if (gateway.provider === 'stripe') {
    const base = (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
    // Only honor a same-origin returnUrl as the Stripe success redirect target.
    const successUrl = sameOriginUrl(returnUrl, base) || `${base}/portal/invoices?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/portal/invoices?payment=cancelled`;

    // Create the pending transaction FIRST (provisional reference) so a payable
    // session always has a local record — never leave an orphan paid Stripe
    // session with nothing to reconcile. The real session id replaces the
    // provisional reference below; the tx id also rides in the session metadata.
    const provisionalRef = `pending_stripe_${crypto.randomBytes(8).toString('hex')}`;
    const [txResult] = await db.query(
      `INSERT INTO payment_transactions
       (organization_id, client_id, invoice_id, payment_gateway_id, gateway_reference_id,
        amount, currency, gateway_status, gateway_response_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [organizationId, resolvedClientId, invoiceId, gateway.id, provisionalRef,
        invoice.total, invoice.currency, `Checkout for invoice ${invoice.invoice_number}`],
    );
    const transactionId = txResult.insertId;

    let session;
    try {
      session = await paymentGatewayService.createStripeCheckoutSession(gateway, {
        amount: parseFloat(invoice.total),
        currency: invoice.currency,
        description: `Invoice ${invoice.invoice_number}`,
        successUrl,
        cancelUrl,
        metadata: { invoice_id: invoiceId, client_id: resolvedClientId, transaction_id: transactionId },
      });
    } catch (err) {
      await db.query(
        "UPDATE payment_transactions SET gateway_status = 'failed', gateway_response_message = ? WHERE id = ?",
        [String(err.message || err).slice(0, 255), transactionId],
      ).catch(() => {});
      throw err;
    }

    // Store the real session id so the checkout.session.completed webhook matches.
    await db.query('UPDATE payment_transactions SET gateway_reference_id = ? WHERE id = ?', [session.id, transactionId]);

    return {
      checkout_id: transactionId,
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number,
      amount: invoice.total,
      currency: invoice.currency,
      expires_at: expiresAt.toISOString(),
      payment_url: session.url, // Stripe-hosted checkout page
      provider: 'stripe',
      return_url: returnUrl || null,
    };
  }

  // Other providers (conekta/manual/...): the existing internal token flow.
  const token = crypto.randomBytes(32).toString('hex');
  const gatewayReferenceId = `chk_${token.slice(0, 32)}`;
  const [result] = await db.query(
    `INSERT INTO payment_transactions
     (organization_id, client_id, invoice_id, payment_gateway_id, gateway_reference_id,
      amount, currency, gateway_status, gateway_response_message, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [organizationId, resolvedClientId, invoiceId, gateway.id, gatewayReferenceId,
      invoice.total, invoice.currency, `Payment for invoice ${invoice.invoice_number}`, token],
  );

  return {
    checkout_id: result.insertId,
    token,
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    amount: invoice.total,
    currency: invoice.currency,
    expires_at: expiresAt.toISOString(),
    payment_url: `${config.appUrl || 'http://localhost:3000'}/pay/${token}`,
    return_url: returnUrl || null,
  };
}

/**
 * Generate a payment link for an invoice.
 * The link can be sent via email/SMS to the client.
 */
async function generatePaymentLink({ organizationId, invoiceId }) {
  const [invoices] = await db.query(
    'SELECT i.*, c.name, c.email FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ? AND i.organization_id = ?',
    [invoiceId, organizationId],
  );
  if (invoices.length === 0) throw new Error('Invoice not found');

  const invoice = invoices[0];
  if (invoice.status === 'paid') throw new Error('Invoice already paid');

  // Reuse checkout session creation
  const session = await createCheckoutSession({
    organizationId,
    invoiceId,
    clientId: invoice.client_id,
  });

  return {
    ...session,
    client_name: invoice.name || '',
    client_email: invoice.email,
  };
}

/**
 * Process a recurring charge for a stored payment profile.
 */
async function chargeRecurringProfile(profileId) {
  const [profiles] = await db.query(
    `SELECT rp.*, pg.provider, pg.organization_id, pg.id AS gateway_id
     FROM recurring_payment_profiles rp
     JOIN payment_gateways pg ON pg.id = rp.payment_gateway_id
     WHERE rp.id = ? AND rp.status = 'active'`,
    [profileId],
  );

  if (profiles.length === 0) throw new Error('Active recurring profile not found');
  const profile = profiles[0];

  // Find the next unpaid invoice for this client
  const [invoices] = await db.query(
    `SELECT * FROM invoices
     WHERE client_id = ? AND organization_id = ? AND status = 'issued'
     ORDER BY due_date ASC LIMIT 1`,
    [profile.client_id, profile.organization_id],
  );

  if (invoices.length === 0) {
    return { charged: false, skipped: true, message: 'No pending invoices for this client' };
  }

  const invoice = invoices[0];
  const idempotencyKey = `recurring_${profileId}_${invoice.id}_${Date.now()}`;
  const amount = parseFloat(invoice.total);
  const description = `Recurring payment for invoice ${invoice.invoice_number}`;

  // recurring_payment_profiles has no `gateway_token` column — the stored card
  // token is `token_reference` (database/schema.sql; paymentRetryService gets
  // this right: `rp.token_reference AS payment_method_token`). Reading the
  // nonexistent column silently returned `undefined` for every profile, so
  // every autopay attempt sent Stripe a PaymentIntent with NO payment_method —
  // which Stripe *accepts* and parks in `requires_payment_method` forever
  // (chargeStripe maps any non-'succeeded' status to 'pending'), and
  // `charged: result.status !== 'failed'` then reported that dead attempt as a
  // SUCCESSFUL charge. Never even call the gateway with no stored token: it
  // cannot possibly succeed, and doing so burns an idempotency key and a live
  // API call for nothing.
  const token = profile.token_reference;
  let result;
  if (!token || !String(token).trim()) {
    logger.warn({ profileId, clientId: profile.client_id }, 'Recurring profile has no stored payment method token — not calling the gateway');
    const [txResult] = await db.query(
      `INSERT INTO payment_transactions
         (organization_id, payment_gateway_id, client_id, amount, currency,
          gateway_reference_id, gateway_status, gateway_response_message, invoice_id, idempotency_key, raw_request)
       VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?)`,
      [
        profile.organization_id, profile.gateway_id, profile.client_id, amount, invoice.currency,
        `no_token:${idempotencyKey}`, 'Recurring payment profile has no stored payment method token',
        invoice.id, idempotencyKey, JSON.stringify({ description, amount, currency: invoice.currency }),
      ],
    );
    result = {
      transaction_id: txResult.insertId,
      status: 'failed',
      error: 'Recurring payment profile has no stored payment method token',
    };
  } else {
    result = await paymentGatewayService.charge({
      organizationId: profile.organization_id,
      clientId: profile.client_id,
      amount,
      currency: invoice.currency,
      description,
      paymentMethodToken: token,
      // Off-session (unattended) charge of the saved, mandate-backed card. Without
      // the customer + off_session flag Stripe returns authentication_required.
      customer: profile.stripe_customer_id || undefined,
      offSession: true,
      // Settle exactly the invoice we charged for (reconcile keys off invoice_id)
      // instead of the oldest-issued-amount heuristic, which mis-attributes when a
      // client has two equal-total issued invoices.
      invoiceId: invoice.id,
      idempotencyKey,
    });
  }

  // NOTE: there is no `last_charged_at` column on recurring_payment_profiles
  // (database/schema.sql). The UPDATE that used to be here threw on every run —
  // *after* the card had already been charged. The charge is recorded in
  // payment_transactions, which is where the last charge is read from.

  // 'succeeded' is the only gateway_status that means money actually moved.
  // 'pending' (3-D Secure still in progress, an async payment method, or — as
  // above — a PaymentIntent that was never given a payment method and never
  // will be) must NOT be reported as charged, and must feed the retry
  // scheduler exactly like a hard failure so a stuck/declined profile doesn't
  // silently stop collecting forever with nobody notified.
  const charged = result.status === 'succeeded';
  if (!charged && result.transaction_id) {
    try {
      await paymentRetryService.scheduleRetry({
        transactionId: result.transaction_id,
        organizationId: profile.organization_id,
        clientId: profile.client_id,
        amount,
        currency: invoice.currency,
        invoiceId: invoice.id,
        recurringProfileId: profileId,
        errorMessage: result.error || `Charge not completed (gateway status: ${result.status})`,
      });
    } catch (retryErr) {
      logger.error({ retryErr, transactionId: result.transaction_id }, 'Failed to schedule payment retry');
    }
  }

  return {
    charged,
    profile_id: profileId,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    amount: invoice.total,
    currency: invoice.currency,
    transaction: result,
  };
}

/**
 * Auto-charge all active recurring profiles with pending invoices.
 */
async function processRecurringCharges(organizationId) {
  const orgFilter = organizationId ? 'AND pg.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [profiles] = await db.query(`
    SELECT rp.id
    FROM recurring_payment_profiles rp
    JOIN payment_gateways pg ON pg.id = rp.payment_gateway_id
    WHERE rp.status = 'active' AND rp.is_default = TRUE ${orgFilter}
  `, params);

  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of profiles) {
    try {
      const result = await chargeRecurringProfile(profile.id);
      // `skipped` means there was nothing to charge (no pending invoice) — not
      // "we tried and the gateway didn't collect". An attempted-but-uncharged
      // outcome (declined, no token, still pending) is a `failed` run so it
      // shows up in the operator-facing count instead of being lost among
      // ordinary skips; the retry is already scheduled inside
      // chargeRecurringProfile.
      if (result.charged) charged++;
      else if (result.skipped) skipped++;
      else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, profileId: profile.id }, 'Recurring charge failed');
    }
  }

  return { charged, skipped, failed, total: profiles.length };
}

module.exports = { createCheckoutSession, generatePaymentLink, chargeRecurringProfile, processRecurringCharges };
