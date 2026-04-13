// =============================================================================
// FireISP 5.0 — Payment Webhook Receiver Routes
// =============================================================================
// Receives inbound webhooks from payment gateways (Stripe, Conekta).
// These endpoints are PUBLIC (no JWT auth) — authentication is done via
// HMAC signature verification per provider.
//
// POST /api/payment-webhooks/stripe   — Stripe webhook receiver
// POST /api/payment-webhooks/conekta  — Conekta webhook receiver
// =============================================================================

const { Router } = require('express');
const paymentGatewayService = require('../services/paymentGatewayService');
const logger = require('../utils/logger');

const router = Router();

// ---------------------------------------------------------------------------
// Stripe webhook receiver
// ---------------------------------------------------------------------------
router.post('/stripe', async (req, res) => {
  const sigHeader = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify signature
  if (webhookSecret) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const valid = paymentGatewayService.verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      logger.warn({ sigHeader }, 'Invalid Stripe webhook signature');
      return res.status(401).json({
        error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature' },
      });
    }
  }

  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

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
  const digestHeader = req.headers['digest'];
  const webhookKey = process.env.CONEKTA_WEBHOOK_KEY;

  // Verify signature
  if (webhookKey) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const valid = paymentGatewayService.verifyConektaSignature(rawBody, digestHeader, webhookKey);
    if (!valid) {
      logger.warn({ digestHeader }, 'Invalid Conekta webhook signature');
      return res.status(401).json({
        error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature' },
      });
    }
  }

  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

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
