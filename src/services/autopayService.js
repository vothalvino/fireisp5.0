// =============================================================================
// FireISP 5.0 — Autopay enrollment (Stripe off-session card capture)
// =============================================================================
// Captures a reusable card via a Stripe Checkout Session in SETUP mode (Stripe
// collects the card AND the SCA mandate that makes off-session charging legal),
// then stores the resulting customer + payment_method on a recurring_payment_
// profile so chargeRecurringProfile can charge it unattended (off_session=true).
// =============================================================================

const db = require('../config/database');
const config = require('../config');
const paymentGatewayService = require('./paymentGatewayService');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../utils/errors');

function sameOriginUrl(url, base) {
  if (!url) return null;
  try { return new URL(url).origin === new URL(base).origin ? url : null; } catch (_e) { return null; }
}

async function resolveStripeGateway(organizationId) {
  if (!organizationId) return null;
  const [gateways] = await db.query(
    `SELECT id, provider, secret_key_encrypted FROM payment_gateways
      WHERE organization_id = ? AND provider = 'stripe' AND status = 'active'
      ORDER BY is_default DESC, id ASC LIMIT 1`,
    [organizationId],
  );
  return gateways[0] || null;
}

/**
 * Begin autopay enrollment: create a Stripe customer for the client and a
 * Checkout Session in setup mode; the client is redirected to Stripe to save a
 * card. Returns { setup_url }.
 */
async function startEnrollment({ organizationId, clientId, returnUrl }) {
  const gateway = await resolveStripeGateway(organizationId);
  if (!gateway) throw new ValidationError('Autopay requires an active Stripe payment gateway');

  const [clients] = await db.query(
    'SELECT email FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [clientId, organizationId],
  );
  if (clients.length === 0) throw new NotFoundError('Client');

  const customerId = await paymentGatewayService.createStripeCustomer(gateway, {
    email: clients[0].email || undefined,
    metadata: { client_id: clientId, organization_id: organizationId },
  });

  const base = (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const successUrl = sameOriginUrl(returnUrl, base) || `${base}/portal/account?autopay=enabled&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/portal/account?autopay=cancelled`;

  const session = await paymentGatewayService.createStripeSetupSession(gateway, {
    customerId,
    successUrl,
    cancelUrl,
    metadata: { client_id: clientId, organization_id: organizationId, gateway_id: gateway.id, purpose: 'autopay' },
  });
  return { setup_url: session.url, provider: 'stripe' };
}

/**
 * Finish enrollment from the completed setup session (called by the webhook):
 * read the saved payment_method + customer and store them as the client's
 * default recurring_payment_profile.
 */
async function completeEnrollment({ sessionId, organizationId }) {
  const gateway = await resolveStripeGateway(organizationId);
  if (!gateway) return;
  const s = await paymentGatewayService.retrieveStripeCheckoutSession(gateway, sessionId);
  if (s.mode !== 'setup' || !s.paymentMethod || !s.customer) return;
  const clientId = s.metadata && s.metadata.client_id;
  if (!clientId) return;

  // The new card becomes the sole default autopay profile for this client+gateway.
  await db.query(
    'UPDATE recurring_payment_profiles SET is_default = 0 WHERE client_id = ? AND payment_gateway_id = ?',
    [clientId, gateway.id],
  );
  await db.query(
    `INSERT INTO recurring_payment_profiles
       (client_id, payment_gateway_id, token_reference, stripe_customer_id, is_default, status)
     VALUES (?, ?, ?, ?, 1, 'active')`,
    [clientId, gateway.id, s.paymentMethod, s.customer],
  );
  logger.info({ clientId, gatewayId: gateway.id }, 'Autopay profile enrolled via Stripe setup session');
}

module.exports = { startEnrollment, completeEnrollment };
