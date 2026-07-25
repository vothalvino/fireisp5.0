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
    `SELECT id, provider, organization_id, secret_key_encrypted FROM payment_gateways
      WHERE organization_id = ? AND provider = 'stripe' AND status = 'active'
      ORDER BY is_default DESC, id ASC LIMIT 1`,
    [organizationId],
  );
  return gateways[0] || null;
}

// Load the exact gateway the enrollment was started against (by id from the
// session metadata). Preferred over org-resolve at completion time: the global
// env-var webhook route has no org, and an org with several Stripe gateways must
// finish on the SAME one the customer + card were created under.
async function loadStripeGatewayById(gatewayId) {
  if (!gatewayId) return null;
  const [gateways] = await db.query(
    `SELECT id, provider, organization_id, secret_key_encrypted FROM payment_gateways
      WHERE id = ? AND provider = 'stripe' AND status = 'active'`,
    [gatewayId],
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
async function completeEnrollment({ sessionId, organizationId, metadata = {} }) {
  // Prefer the gateway captured at enrollment (metadata.gateway_id) — works on the
  // global env-var webhook route (organizationId is undefined there) and pins the
  // completion to the SAME gateway the customer/card were created under. Fall back
  // to org-resolve only if the metadata is absent (older sessions).
  const metaGatewayId = metadata.gateway_id ? Number(metadata.gateway_id) : null;
  const metaOrgId = metadata.organization_id ? Number(metadata.organization_id) : null;
  const gateway = (await loadStripeGatewayById(metaGatewayId))
    || (await resolveStripeGateway(organizationId || metaOrgId));
  if (!gateway) {
    logger.warn({ sessionId, metaGatewayId, organizationId }, 'Autopay completion: no matching Stripe gateway — enrollment dropped');
    return;
  }

  const s = await paymentGatewayService.retrieveStripeCheckoutSession(gateway, sessionId);
  if (s.mode !== 'setup' || !s.paymentMethod || !s.customer) return;
  const clientId = (s.metadata && s.metadata.client_id) || metadata.client_id;
  if (!clientId) return;

  // Defence-in-depth: only store a profile for a client that actually belongs to
  // this gateway's org (guards the shared-Stripe-account case where org A's setup
  // event could be delivered to org B's per-gateway endpoint).
  const [owners] = await db.query(
    'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [clientId, gateway.organization_id],
  );
  if (owners.length === 0) {
    logger.warn({ clientId, gatewayOrg: gateway.organization_id }, 'Autopay completion: client does not belong to gateway org — enrollment dropped');
    return;
  }

  const card = s.card || {};
  // The new card becomes the sole default autopay profile for this client+gateway.
  // A unique index (migration 423) guarantees at most one ACTIVE default row per
  // (client, gateway) even if two setup sessions complete concurrently — the
  // losing INSERT trips ER_DUP_ENTRY, which we treat as "already enrolled".
  await db.query(
    'UPDATE recurring_payment_profiles SET is_default = 0 WHERE client_id = ? AND payment_gateway_id = ?',
    [clientId, gateway.id],
  );
  try {
    await db.query(
      `INSERT INTO recurring_payment_profiles
         (client_id, payment_gateway_id, token_reference, stripe_customer_id,
          card_brand, card_last_four, card_exp_month, card_exp_year, is_default, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
      [clientId, gateway.id, s.paymentMethod, s.customer,
        card.brand || null, card.last4 || null, card.expMonth || null, card.expYear || null],
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      logger.info({ clientId, gatewayId: gateway.id }, 'Autopay profile already enrolled by a concurrent completion — skipping duplicate');
      return;
    }
    throw err;
  }
  logger.info({ clientId, gatewayId: gateway.id }, 'Autopay profile enrolled via Stripe setup session');
}

module.exports = { startEnrollment, completeEnrollment };
