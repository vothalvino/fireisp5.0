// =============================================================================
// FireISP 5.0 — WhatsApp inbound webhook routes
// =============================================================================
// PUBLIC (no JWT). Authenticated by the provider's signature. Security posture
// mirrors paymentWebhooks.js (fail closed):
//   - provider not configured / no signing secret -> 503 (unless
//     ALLOW_UNSIGNED_WEBHOOKS, local testing only)
//   - signature present but invalid                -> 401
//   - genuine downstream failure                   -> 500 (provider retries)
// GET is Meta's verification handshake.
// =============================================================================

const { Router } = require('express');
const logger = require('../utils/logger');
const webhookSvc = require('../services/whatsappWebhookService');
const wa = require('../services/whatsappService');
const bot = require('../services/whatsappBotService');
const outbound = require('../services/whatsappOutbound');

const router = Router();

function unsignedAllowed() {
  return /^(1|true|yes|on)$/i.test(process.env.ALLOW_UNSIGNED_WEBHOOKS || '');
}

// GET /whatsapp/webhook — Meta verification handshake.
router.get('/webhook', (req, res) => {
  const challenge = webhookSvc.metaChallenge(req.query || {});
  if (challenge !== null && challenge !== undefined) {
    return res.status(200).send(String(challenge));
  }
  return res.status(403).json({ error: { code: 'WEBHOOK_VERIFY_FAILED', message: 'Verification failed' } });
});

// POST /whatsapp/webhook — inbound messages.
router.post('/webhook', async (req, res) => {
  const provider = webhookSvc.detectProvider();
  if (!provider) {
    logger.warn('whatsapp webhook: no provider configured — rejecting (fail closed)');
    return res.status(503).json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'WhatsApp webhook is not configured' } });
  }

  if (!webhookSvc.isConfigured(provider)) {
    if (unsignedAllowed()) {
      logger.warn({ provider }, 'whatsapp webhook: processing an UNSIGNED payload because ALLOW_UNSIGNED_WEBHOOKS is set — insecure, never enable in production');
    } else {
      logger.warn({ provider }, 'whatsapp webhook: signing secret not configured — rejecting (fail closed)');
      return res.status(503).json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'WhatsApp webhook signature verification is not configured' } });
    }
  } else if (!webhookSvc.verifyRequestSignature(provider, req)) {
    logger.warn({ provider }, 'whatsapp webhook: invalid signature');
    return res.status(401).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature' } });
  }

  let messages;
  try {
    messages = webhookSvc.parseInboundMessages(provider, req);
  } catch (err) {
    logger.warn({ err, provider }, 'whatsapp webhook: malformed payload');
    return res.status(400).json({ error: { code: 'WEBHOOK_INVALID_PAYLOAD', message: 'Malformed webhook payload' } });
  }

  // Ack immediately so the provider's delivery window is never blocked on our
  // downstream work (the bot + a live outbound HTTPS reply, up to 15s). Work
  // continues async; the (provider, provider_message_id) dedup makes any
  // redelivery a no-op, so we never double-process. Messages in one batch are
  // processed SEQUENTIALLY so a same-sender burst can't race the per-client
  // ticket cap (check-then-act) within a single delivery.
  res.status(200).json({ received: true });
  (async () => {
    for (const m of messages) {
      await processMessage(provider, m).catch((err) => logger.error({ err, provider }, 'whatsapp webhook async processing error'));
    }
  })();
});

async function processMessage(provider, m) {
  if (!m || !m.providerMessageId || !m.from) return;
  const phone = wa.normalizeE164(m.from);
  if (!phone) return;

  // Dedup on provider_message_id — skip work on a provider redelivery.
  const { isNew } = await wa.recordInbound({
    provider,
    providerMessageId: m.providerMessageId,
    phone,
    toNumber: m.to || null,
    body: m.body || null,
  });
  if (!isNew) return;

  const { reply, clientId } = await bot.handleInbound({ phone, body: m.body || '' });

  // Org is only known once bound — resolve it so a connected client's reply is
  // logged to sms_logs (unbound replies are sent but not logged: org is NOT NULL),
  // and backfill the resolved owner onto the inbound audit row.
  let organizationId = null;
  if (clientId) {
    const binding = await wa.resolveBinding(phone);
    organizationId = binding?.organizationId ?? null;
    await wa.setInboundOwner({ provider, providerMessageId: m.providerMessageId, clientId, organizationId });
  }
  if (!reply) return;
  await outbound.sendReply({ provider, to: phone, body: reply, organizationId, clientId: clientId || null });
}

module.exports = router;
