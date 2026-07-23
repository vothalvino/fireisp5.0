// =============================================================================
// FireISP 5.0 — Payment Webhook Receiver Routes
// =============================================================================
// Receives inbound webhooks from payment gateways (Stripe, Conekta).
// These endpoints are PUBLIC (no JWT auth) — authentication is done via
// HMAC signature verification per provider.
//
// POST /api/payment-webhooks/stripe   — Stripe webhook receiver
// POST /api/payment-webhooks/conekta  — Conekta webhook receiver
//
// Security posture (fail closed): a webhook the server cannot authenticate is
// never acted on. If the provider's signing secret is not configured the
// request is rejected with 503 — NOT silently trusted — unless the operator
// has explicitly set ALLOW_UNSIGNED_WEBHOOKS (local/dev testing only). A
// malformed or probing body (not a `{id, type}` event) is rejected with 400
// before it can reach the processing pipeline; only a genuine downstream
// failure returns 500 (so the provider retries).
// =============================================================================

const { Router } = require('express');
const paymentGatewayService = require('../services/paymentGatewayService');
const logger = require('../utils/logger');

const router = Router();

// Env is read per-request (not memoized) so tests and runtime config changes
// take effect without a restart.
function unsignedWebhooksAllowed() {
  return /^(1|true|yes|on)$/i.test(process.env.ALLOW_UNSIGNED_WEBHOOKS || '');
}

// Decide whether a webhook request is authorized to proceed.
// Returns null when authorized, otherwise an { status, code, message } to send.
//   - secret set   → signature must verify (else 401)
//   - secret unset → 503, unless ALLOW_UNSIGNED_WEBHOOKS is on (dev only)
function webhookAuthError({ provider, secret, envVarName, rawBody, sigHeader, verify }) {
  if (secret) {
    if (!verify(rawBody, sigHeader, secret)) {
      logger.warn({ provider, sigHeader }, `Invalid ${provider} webhook signature`);
      return { status: 401, code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature' };
    }
    return null;
  }
  if (unsignedWebhooksAllowed()) {
    logger.warn(
      { provider },
      `${provider} webhook secret not configured — processing an UNSIGNED payload because ALLOW_UNSIGNED_WEBHOOKS is set. This is insecure; never enable it in production.`,
    );
    return null;
  }
  logger.warn(
    { provider },
    `${provider} webhook secret not configured — rejecting the request (fail closed). Set ${envVarName} to enable signature verification, or ALLOW_UNSIGNED_WEBHOOKS=true for local testing only.`,
  );
  return { status: 503, code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook signature verification is not configured' };
}

// A provider webhook event is always a JSON object carrying a non-empty string
// `id` and `type`. Reject anything else with 400 so a malformed/probing body
// cannot reach handleWebhookEvent (where an undefined id would throw a 500).
function invalidEventError(event) {
  const ok = event && typeof event === 'object' && !Array.isArray(event)
    && typeof event.id === 'string' && event.id
    && typeof event.type === 'string' && event.type;
  if (ok) return null;
  return { status: 400, code: 'WEBHOOK_INVALID_PAYLOAD', message: 'Malformed webhook payload' };
}

function sendError(res, e) {
  return res.status(e.status).json({ error: { code: e.code, message: e.message } });
}

// ---------------------------------------------------------------------------
// Stripe webhook receiver
// ---------------------------------------------------------------------------
router.post('/stripe', async (req, res) => {
  // Verify signature over the raw body for byte-exact match with the provider.
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const authErr = webhookAuthError({
    provider: 'stripe',
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    envVarName: 'STRIPE_WEBHOOK_SECRET',
    rawBody,
    sigHeader: req.headers['stripe-signature'],
    verify: (b, h, s) => paymentGatewayService.verifyStripeSignature(b, h, s),
  });
  if (authErr) return sendError(res, authErr);

  const event = req.body;
  const shapeErr = invalidEventError(event);
  if (shapeErr) {
    logger.warn({ provider: 'stripe' }, 'Rejected malformed Stripe webhook payload');
    return sendError(res, shapeErr);
  }

  try {
    const result = await paymentGatewayService.handleWebhookEvent({
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      payload: event,
    });

    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Stripe webhook processing error');
    return res.status(500).json({
      error: { code: 'WEBHOOK_PROCESSING_ERROR', message: 'Webhook processing failed' },
    });
  }
});

// ---------------------------------------------------------------------------
// Conekta webhook receiver
// ---------------------------------------------------------------------------
router.post('/conekta', async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const authErr = webhookAuthError({
    provider: 'conekta',
    secret: process.env.CONEKTA_WEBHOOK_KEY,
    envVarName: 'CONEKTA_WEBHOOK_KEY',
    rawBody,
    sigHeader: req.headers['digest'],
    verify: (b, h, s) => paymentGatewayService.verifyConektaSignature(b, h, s),
  });
  if (authErr) return sendError(res, authErr);

  const event = req.body;
  const shapeErr = invalidEventError(event);
  if (shapeErr) {
    logger.warn({ provider: 'conekta' }, 'Rejected malformed Conekta webhook payload');
    return sendError(res, shapeErr);
  }

  try {
    const result = await paymentGatewayService.handleWebhookEvent({
      provider: 'conekta',
      providerEventId: event.id,
      eventType: event.type,
      payload: event,
    });

    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Conekta webhook processing error');
    return res.status(500).json({
      error: { code: 'WEBHOOK_PROCESSING_ERROR', message: 'Webhook processing failed' },
    });
  }
});

module.exports = router;
