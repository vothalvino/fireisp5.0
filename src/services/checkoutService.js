// =============================================================================
// FireISP 5.0 — Checkout / Payment Flow Service
// =============================================================================
// Handles payment link generation, checkout sessions, and auto-charge
// for recurring payment profiles.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const paymentGatewayService = require('./paymentGatewayService');
const paymentRetryService = require('./paymentRetryService');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

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
  if (invoice.status === 'paid') throw new Error('Invoice already paid');

  // Resolve the organization's payment gateway: prefer the default, otherwise
  // fall back to the first active gateway. payment_transactions.payment_gateway_id
  // is NOT NULL, so a missing gateway is a client-fixable configuration error (422),
  // not a 500.
  const [gateways] = await db.query(
    `SELECT id FROM payment_gateways
     WHERE organization_id = ? AND status = 'active'
     ORDER BY is_default DESC, id ASC
     LIMIT 1`,
    [organizationId],
  );
  if (gateways.length === 0) {
    throw new ValidationError('No active payment gateway is configured for this organization');
  }
  const paymentGatewayId = gateways[0].id;

  // Generate a unique checkout token and a gateway reference for this attempt.
  const token = crypto.randomBytes(32).toString('hex');
  const gatewayReferenceId = `chk_${token.slice(0, 32)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Store the session in payment_transactions as 'pending'
  const [result] = await db.query(
    `INSERT INTO payment_transactions
     (organization_id, client_id, payment_gateway_id, gateway_reference_id,
      amount, currency, gateway_status, gateway_response_message, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [organizationId, clientId || invoice.client_id, paymentGatewayId, gatewayReferenceId,
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
    payment_url: `${process.env.APP_URL || 'http://localhost:3000'}/pay/${token}`,
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
    return { charged: false, message: 'No pending invoices for this client' };
  }

  const invoice = invoices[0];
  const idempotencyKey = `recurring_${profileId}_${invoice.id}_${Date.now()}`;

  const result = await paymentGatewayService.charge({
    organizationId: profile.organization_id,
    clientId: profile.client_id,
    amount: parseFloat(invoice.total),
    currency: invoice.currency,
    description: `Recurring payment for invoice ${invoice.invoice_number}`,
    paymentMethodToken: profile.gateway_token,
    idempotencyKey,
  });

  // NOTE: there is no `last_charged_at` column on recurring_payment_profiles
  // (database/schema.sql). The UPDATE that used to be here threw on every run —
  // *after* the card had already been charged. The charge is recorded in
  // payment_transactions, which is where the last charge is read from.

  // Schedule retry if charge failed
  if (result.status === 'failed' && result.transaction_id) {
    try {
      await paymentRetryService.scheduleRetry({
        transactionId: result.transaction_id,
        organizationId: profile.organization_id,
        clientId: profile.client_id,
        amount: parseFloat(invoice.total),
        currency: invoice.currency,
        invoiceId: invoice.id,
        recurringProfileId: profileId,
        errorMessage: result.error || 'Charge failed',
      });
    } catch (retryErr) {
      logger.error({ retryErr, transactionId: result.transaction_id }, 'Failed to schedule payment retry');
    }
  }

  return {
    charged: result.status !== 'failed',
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
      if (result.charged) charged++;
      else skipped++;
    } catch (err) {
      failed++;
      logger.error({ err, profileId: profile.id }, 'Recurring charge failed');
    }
  }

  return { charged, skipped, failed, total: profiles.length };
}

module.exports = { createCheckoutSession, generatePaymentLink, chargeRecurringProfile, processRecurringCharges };
