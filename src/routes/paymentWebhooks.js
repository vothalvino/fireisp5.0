// =============================================================================
// FireISP 5.0 — Payment Webhook Receiver Routes
// =============================================================================
// Receives inbound webhooks from payment gateways (Stripe, Conekta).
// These endpoints are PUBLIC (no JWT auth) — authentication is done via
// HMAC signature verification per provider.
//
// Two shapes per provider:
//   POST /api/payment-webhooks/stripe            — global receiver; signing
//   POST /api/payment-webhooks/conekta             secret from the env var.
//   POST /api/payment-webhooks/stripe/:gatewayId  — multi-tenant receiver; the
//   POST /api/payment-webhooks/conekta/:gatewayId   signing secret comes from
//        that org's payment_gateways.webhook_secret_encrypted, and the event is
//        reconciled only against that org's transactions. Configure the
//        provider dashboard to POST to the :gatewayId URL and store the
//        provider's signing secret on that gateway in Settings.
//
// Security posture (fail closed): a webhook the server cannot authenticate is
// never acted on. If no signing secret is available (env var unset, or the
// gateway has none) the request is rejected with 503 — NOT silently trusted —
// unless the operator has explicitly set ALLOW_UNSIGNED_WEBHOOKS (local/dev
// testing only). A malformed / probing body (not a `{id, type}` event) is
// rejected with 400 before it can reach the processing pipeline; only a genuine
// downstream failure returns 500 (so the provider retries).
// =============================================================================

const { Router } = require('express');
const paymentGatewayService = require('../services/paymentGatewayService');
const logger = require('../utils/logger');

const router = Router();

const PROVIDERS = {
  stripe: {
    envVarName: 'STRIPE_WEBHOOK_SECRET',
    sigHeaderName: 'stripe-signature',
    verify: (b, h, s) => paymentGatewayService.verifyStripeSignature(b, h, s),
  },
  conekta: {
    envVarName: 'CONEKTA_WEBHOOK_KEY',
    sigHeaderName: 'digest',
    verify: (b, h, s) => paymentGatewayService.verifyConektaSignature(b, h, s),
  },
};

// Env is read per-request (not memoized) so tests and runtime config changes
// take effect without a restart.
function unsignedWebhooksAllowed() {
  return /^(1|true|yes|on)$/i.test(process.env.ALLOW_UNSIGNED_WEBHOOKS || '');
}

// Decide whether a webhook request is authorized to proceed.
// Returns null when authorized, otherwise an { status, code, message } to send.
//   - secret present → signature must verify (else 401)
//   - secret absent  → 503, unless ALLOW_UNSIGNED_WEBHOOKS is on (dev only)
function webhookAuthError({ provider, secret, configHint, rawBody, sigHeader, verify }) {
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
    `${provider} webhook secret not configured — rejecting the request (fail closed). ${configHint}`,
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

// Shared processing once the signing secret (and optional tenant) are resolved.
async function processWebhook(req, res, { provider, secret, organizationId, configHint }) {
  const cfg = PROVIDERS[provider];
  // Verify over the raw body for a byte-exact match with the provider.
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const authErr = webhookAuthError({
    provider,
    secret,
    configHint,
    rawBody,
    sigHeader: req.headers[cfg.sigHeaderName],
    verify: cfg.verify,
  });
  if (authErr) return sendError(res, authErr);

  const event = req.body;
  const shapeErr = invalidEventError(event);
  if (shapeErr) {
    logger.warn({ provider }, `Rejected malformed ${provider} webhook payload`);
    return sendError(res, shapeErr);
  }

  try {
    const result = await paymentGatewayService.handleWebhookEvent({
      provider,
      providerEventId: event.id,
      eventType: event.type,
      payload: event,
      organizationId,
    });
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    logger.error({ err, provider, eventId: event.id }, `${provider} webhook processing error`);
    return res.status(500).json({
      error: { code: 'WEBHOOK_PROCESSING_ERROR', message: 'Webhook processing failed' },
    });
  }
}

// Global (env-var) receiver: one signing secret for the whole install.
function envHandler(provider) {
  return (req, res) => processWebhook(req, res, {
    provider,
    secret: process.env[PROVIDERS[provider].envVarName],
    organizationId: undefined,
    configHint: `Set ${PROVIDERS[provider].envVarName}, use the per-gateway /${provider}/:gatewayId URL, or ALLOW_UNSIGNED_WEBHOOKS=true for local testing only.`,
  });
}

// Multi-tenant receiver: signing secret + tenant come from the gateway row.
function gatewayHandler(provider) {
  return async (req, res) => {
    let ctx;
    try {
      ctx = await paymentGatewayService.loadGatewayWebhookContext({ provider, gatewayId: req.params.gatewayId });
    } catch (err) {
      logger.error({ err, provider, gatewayId: req.params.gatewayId }, 'Failed to load gateway webhook context');
      return res.status(500).json({ error: { code: 'WEBHOOK_PROCESSING_ERROR', message: 'Webhook processing failed' } });
    }
    if (!ctx.found) {
      return res.status(404).json({ error: { code: 'WEBHOOK_GATEWAY_NOT_FOUND', message: 'Unknown payment gateway' } });
    }
    // Note: the distinct 404/503/401 outcomes let an unauthenticated caller walk
    // sequential gatewayIds to learn which are active and which lack a signing
    // secret. Accepted as low risk: it's rate-limited (webhookLimiter), leaks no
    // secret and moves no money (the signature still gates all action), and the
    // informative codes are what a provider dashboard / operator needs to debug
    // setup. Do not collapse them without a better operator signal.
    return processWebhook(req, res, {
      provider,
      secret: ctx.webhookSecret,
      organizationId: ctx.organizationId,
      configHint: `Set the webhook signing secret on this ${provider} gateway in Settings, or ALLOW_UNSIGNED_WEBHOOKS=true for local testing only.`,
    });
  };
}

// Per-gateway routes are declared before the bare routes for clarity; Express
// matches by path shape either way (different depths, no conflict).
router.post('/stripe/:gatewayId', gatewayHandler('stripe'));
router.post('/conekta/:gatewayId', gatewayHandler('conekta'));
router.post('/stripe', envHandler('stripe'));
router.post('/conekta', envHandler('conekta'));

module.exports = router;
