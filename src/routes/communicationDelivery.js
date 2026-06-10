// =============================================================================
// FireISP 5.0 — Communication Delivery Webhook Route — §1.4
// =============================================================================
// Receives provider delivery status callbacks (email and SMS providers).
// No authentication — uses a shared secret header for basic verification.
// Mounted at /communication in app.js.
// =============================================================================

const { Router } = require('express');
const campaignService = require('../services/campaignService');
const logger = require('../utils/logger');

const router = Router();

// Map Twilio MessageStatus values to our internal statuses
const TWILIO_STATUS_MAP = {
  delivered:   'delivered',
  undelivered: 'failed',
  failed:      'failed',
  read:        'opened',
};

/**
 * @openapi
 * /communication/delivery-webhook:
 *   post:
 *     summary: Receive a provider delivery status callback
 *     tags: [Communication]
 *     description: >
 *       Public webhook endpoint for provider delivery callbacks. Secured via the
 *       WEBHOOK_DELIVERY_SECRET environment variable (sent as X-Webhook-Secret header).
 *       Supports both generic JSON payloads and Twilio StatusCallback POST bodies.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider_message_id:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [delivered, bounced, opened, failed]
 *               timestamp:
 *                 type: string
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               MessageSid:
 *                 type: string
 *               MessageStatus:
 *                 type: string
 *     responses:
 *       200:
 *         description: Callback processed
 *       401:
 *         description: Invalid webhook secret
 */
router.post('/delivery-webhook', async (req, res) => {
  // Verify the webhook secret when configured
  const webhookSecret = process.env.WEBHOOK_DELIVERY_SECRET;
  if (webhookSecret) {
    const provided = req.headers['x-webhook-secret'] || req.headers['x-delivery-secret'];
    if (provided !== webhookSecret) {
      logger.warn({ ip: req.ip }, 'Delivery webhook: invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const body = req.body || {};

    let providerMessageId;
    let newStatus;

    // Detect Twilio StatusCallback format (form-urlencoded via Express body parser)
    if (body.MessageSid && body.MessageStatus) {
      providerMessageId = body.MessageSid;
      newStatus = TWILIO_STATUS_MAP[body.MessageStatus] || null;
    } else {
      // Generic JSON format
      providerMessageId = body.provider_message_id;
      newStatus = body.status;
    }

    if (!providerMessageId || !newStatus) {
      return res.status(200).json({ updated: false, reason: 'missing fields' });
    }

    const result = await campaignService.handleDeliveryCallback(providerMessageId, newStatus, body);
    res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, 'Delivery webhook processing error');
    // Return 200 to avoid provider retry storms
    res.status(200).json({ updated: false, error: err.message });
  }
});

module.exports = router;
