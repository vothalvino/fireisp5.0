// =============================================================================
// FireISP 5.0 — Payment Gateway Service
// =============================================================================
// Abstracts payment processing through configured gateways.
// Supports Stripe, Conekta, and generic card processing.
// Includes idempotency, webhook signature verification, and reconciliation.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { URLSearchParams } = require('url');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { decrypt, isConfigured: isEncryptionConfigured } = require('../utils/encryption');
const logger = require('../utils/logger');
const { PaymentGatewayError } = require('../utils/errors');

// Default idempotency key TTL: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// Maximum rounding difference (in currency units) to consider two amounts
// equal during auto-reconciliation. Accounts for floating-point arithmetic
// when converting between cents and currency units.
const RECONCILE_AMOUNT_TOLERANCE = 0.01;

// Circuit breaker for external payment gateway calls (Stripe, Conekta)
const paymentCircuitBreaker = createCircuitBreaker({
  name: 'PaymentGateway',
  threshold: 5,
  resetMs: 60000,
});

/**
 * Get the active payment gateway for an organization.
 */
async function getActiveGateway(organizationId) {
  const [rows] = await db.query(
    'SELECT * FROM payment_gateways WHERE organization_id = ? AND status = \'active\' LIMIT 1',
    [organizationId],
  );
  return rows[0] || null;
}

/**
 * Resolve the per-gateway webhook context for an inbound, provider-scoped
 * webhook (POST /payment-webhooks/:provider/:gatewayId). The gatewayId comes
 * from the (untrusted) URL, so the row must match the provider on the path and
 * be active. Returns:
 *   { found:false }                                   → unknown/inactive/wrong-provider gateway (404)
 *   { found:true, organizationId, webhookSecret:null} → gateway exists but no webhook secret set (503)
 *   { found:true, organizationId, webhookSecret:'…' } → ready to verify
 * A secret that cannot be decrypted (corrupt ciphertext / wrong key) is treated
 * as not-configured rather than surfacing a 500.
 *
 * @param {object} params
 * @param {string} params.provider   - 'stripe' | 'conekta'
 * @param {number|string} params.gatewayId
 */
async function loadGatewayWebhookContext({ provider, gatewayId }) {
  if (!/^\d+$/.test(String(gatewayId))) return { found: false };

  const [rows] = await db.query(
    `SELECT id, organization_id, webhook_secret_encrypted
       FROM payment_gateways
      WHERE id = ? AND provider = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [gatewayId, provider],
  );
  if (rows.length === 0) return { found: false };

  const gw = rows[0];
  const stored = gw.webhook_secret_encrypted;
  if (!stored) {
    return { found: true, organizationId: gw.organization_id, webhookSecret: null };
  }

  let webhookSecret;
  try {
    webhookSecret = decrypt(stored);
  } catch (err) {
    // Only getKey() (malformed ENCRYPTION_KEY) throws here; a corrupt/rotated
    // ciphertext does NOT — see below.
    logger.error({ err, gatewayId: gw.id, provider }, 'Failed to decrypt gateway webhook secret');
    return { found: true, organizationId: gw.organization_id, webhookSecret: null };
  }

  // decrypt() returns the input UNCHANGED (never throws) when it cannot decrypt
  // a value — wrong/rotated ENCRYPTION_KEY or corrupt bytes. If the stored value
  // is in our ciphertext shape and came back unchanged while encryption is
  // configured, it is genuinely undecryptable: fail closed (503) rather than run
  // signature verification against ciphertext and mislead with a 401.
  if (isEncryptionConfigured() && looksLikeCiphertext(stored) && webhookSecret === stored) {
    logger.error({ gatewayId: gw.id, provider }, 'Gateway webhook secret is undecryptable (wrong/rotated ENCRYPTION_KEY?) — treating as unconfigured');
    return { found: true, organizationId: gw.organization_id, webhookSecret: null };
  }

  return { found: true, organizationId: gw.organization_id, webhookSecret };
}

// Our AES-256-GCM envelope format: hex(iv=12B):hex(tag=16B):hex(ciphertext).
const CIPHERTEXT_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;
function looksLikeCiphertext(v) {
  return typeof v === 'string' && CIPHERTEXT_RE.test(v);
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * Check for an existing idempotency key. Returns the cached response or null.
 */
async function checkIdempotencyKey(organizationId, key) {
  const [rows] = await db.query(
    `SELECT * FROM idempotency_keys
     WHERE organization_id = ? AND idempotency_key = ? AND expires_at > NOW()
     LIMIT 1`,
    [organizationId, key],
  );
  return rows[0] || null;
}

/**
 * Store the result of a charge request under an idempotency key.
 */
async function storeIdempotencyKey(organizationId, key, statusCode, responseBody) {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  await db.query(
    `INSERT INTO idempotency_keys (organization_id, idempotency_key, status, response_code, response_body, expires_at)
     VALUES (?, ?, 'completed', ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = 'completed', response_code = VALUES(response_code),
       response_body = VALUES(response_body), expires_at = VALUES(expires_at)`,
    [organizationId, key, statusCode, JSON.stringify(responseBody), expiresAt],
  );
}

/**
 * Charge a payment through the gateway with optional idempotency.
 * If an idempotencyKey is provided and a cached result exists, the cached
 * result is returned instead of charging again.
 */
async function charge({ organizationId, clientId, amount, currency, description, paymentMethodToken, idempotencyKey }) {
  // --- Idempotency check ---
  if (idempotencyKey) {
    const cached = await checkIdempotencyKey(organizationId, idempotencyKey);
    if (cached && cached.status === 'completed') {
      const body = typeof cached.response_body === 'string'
        ? JSON.parse(cached.response_body)
        : cached.response_body;
      return { ...body, idempotent_replay: true };
    }
  }

  const gateway = await getActiveGateway(organizationId);
  if (!gateway) {
    throw new Error('No active payment gateway configured');
  }

  // Column is `payment_gateway_id`; there is no `description` column. And
  // `gateway_reference_id` is NOT NULL even though the provider only assigns the
  // real reference *after* the charge succeeds (it is overwritten below, and by
  // the webhook handler), so the pending row carries a provisional reference.
  // The description survives in raw_request.
  const provisionalRef = `pending:${idempotencyKey || crypto.randomUUID()}`;
  const [txResult] = await db.query(
    `INSERT INTO payment_transactions
     (organization_id, payment_gateway_id, client_id, amount, currency,
      gateway_reference_id, gateway_status, idempotency_key, raw_request)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [organizationId, gateway.id, clientId, amount, currency || 'MXN',
      provisionalRef, idempotencyKey || null,
      JSON.stringify({ description: description || null, amount, currency: currency || 'MXN' })],
  );

  const transactionId = txResult.insertId;

  try {
    let result;

    switch (gateway.provider) {
      case 'stripe':
        result = await paymentCircuitBreaker.call(() =>
          chargeStripe(gateway, amount, currency || 'MXN', description, paymentMethodToken));
        break;
      case 'conekta':
        result = await paymentCircuitBreaker.call(() =>
          chargeConekta(gateway, amount, currency || 'MXN', description, paymentMethodToken));
        break;
      case 'manual':
        // Manual / offline-recorded payment: no API call needed; record as succeeded.
        result = { gatewayRef: `manual_${Date.now()}`, status: 'succeeded' };
        break;
      default:
        // Provider is configured in the schema but not yet implemented.
        throw new PaymentGatewayError(
          `Payment provider '${gateway.provider}' is not yet supported for automated charges. ` +
          'Use provider \'manual\' to record offline payments, or configure a supported provider (stripe, conekta).',
        );
    }

    await db.query(
      'UPDATE payment_transactions SET gateway_reference_id = ?, gateway_status = ?, raw_response = ? WHERE id = ?',
      [result.gatewayRef, result.status, JSON.stringify(result.rawResponse || null), transactionId],
    );

    const response = {
      transaction_id: transactionId,
      gateway_reference: result.gatewayRef,
      status: result.status,
      provider: gateway.provider,
    };

    // Cache the response under the idempotency key
    if (idempotencyKey) {
      await storeIdempotencyKey(organizationId, idempotencyKey, 200, response);
    }

    return response;
  } catch (err) {
    await db.query(
      'UPDATE payment_transactions SET gateway_status = ?, raw_response = ? WHERE id = ?',
      ['failed', err.message, transactionId],
    );

    const errorResponse = {
      transaction_id: transactionId,
      status: 'failed',
      error: err.message,
    };

    if (idempotencyKey) {
      await storeIdempotencyKey(organizationId, idempotencyKey, 200, errorResponse);
    }

    return errorResponse;
  }
}

/**
 * Charge via Stripe REST API (no SDK — uses built-in https).
 */
async function chargeStripe(gateway, amount, currency, description, paymentMethodToken) {
  const https = require('https');

  const secretKey = decrypt(gateway.secret_key_encrypted);
  const body = new URLSearchParams({
    amount: Math.round(amount * 100).toString(), // Stripe uses cents
    currency: currency.toLowerCase(),
    description: description || 'FireISP payment',
    ...(paymentMethodToken && { payment_method: paymentMethodToken, confirm: 'true' }),
  }).toString();

  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/payment_intents',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Stripe request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const data = JSON.parse(response.body);
  if (response.statusCode >= 400 || data.error) {
    throw new Error(data.error?.message || `Stripe error: HTTP ${response.statusCode}`);
  }

  return {
    gatewayRef: data.id,
    status: data.status === 'succeeded' ? 'succeeded' : 'pending',
    rawResponse: data,
  };
}

/**
 * Charge via Conekta REST API.
 */
async function chargeConekta(gateway, amount, currency, description, _paymentMethodToken) {
  const https = require('https');

  const secretKey = decrypt(gateway.secret_key_encrypted);
  const body = JSON.stringify({
    line_items: [{
      name: description || 'FireISP payment',
      unit_price: Math.round(amount * 100), // Conekta uses cents
      quantity: 1,
    }],
    currency: currency.toUpperCase(),
    charges: [{
      payment_method: { type: 'default' },
    }],
  });

  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.conekta.io',
      path: '/orders',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.conekta-v2.1.0+json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Conekta request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const data = JSON.parse(response.body);
  if (response.statusCode >= 400 || data.type === 'error') {
    throw new Error(data.details?.[0]?.message || `Conekta error: HTTP ${response.statusCode}`);
  }

  return {
    gatewayRef: data.id,
    status: data.payment_status === 'paid' ? 'succeeded' : 'pending',
    rawResponse: data,
  };
}

/**
 * Call the Stripe refunds API for a previously-captured charge or payment intent.
 * @param {object} gateway  - payment_gateways row (with secret_key_encrypted)
 * @param {object} tx       - payment_transactions row
 * @returns {Promise<{gatewayRefundRef: string}>}
 */
async function refundStripe(gateway, tx) {
  const https = require('https');

  const secretKey = decrypt(gateway.secret_key_encrypted);
  const body = new URLSearchParams({
    payment_intent: tx.gateway_reference_id,
  }).toString();

  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/refunds',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Stripe refund request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const data = JSON.parse(response.body);
  if (response.statusCode >= 400 || data.error) {
    throw new PaymentGatewayError(data.error?.message || `Stripe refund error: HTTP ${response.statusCode}`);
  }

  return { gatewayRefundRef: data.id };
}

/**
 * Call the Conekta order refund API for a previously-created order.
 * @param {object} gateway  - payment_gateways row (with secret_key_encrypted)
 * @param {object} tx       - payment_transactions row
 * @returns {Promise<{gatewayRefundRef: string}>}
 */
async function refundConekta(gateway, tx) {
  const https = require('https');

  const secretKey = decrypt(gateway.secret_key_encrypted);
  const body = JSON.stringify({ reason: 'requested_by_customer' });
  const path = `/orders/${tx.gateway_reference_id}/refunds`;

  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.conekta.io',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.conekta-v2.1.0+json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Conekta refund request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const data = JSON.parse(response.body);
  if (response.statusCode >= 400 || data.type === 'error') {
    throw new PaymentGatewayError(
      data.details?.[0]?.message || `Conekta refund error: HTTP ${response.statusCode}`,
    );
  }

  return { gatewayRefundRef: data.id || tx.gateway_reference_id };
}

/**
 * Refund a payment transaction.
 *
 * For stripe/conekta: calls the processor first, then updates the DB only after
 * the processor confirms success. Both external calls are wrapped in the circuit
 * breaker.
 * For manual: DB-only status flip (no processor call needed).
 * For unimplemented providers: throws PaymentGatewayError.
 *
 * @param {number} transactionId
 * @returns {Promise<{transaction_id: number, status: string, gateway_refund_reference?: string}>}
 */
async function refund(transactionId) {
  // Fetch transaction and join to gateway to get the provider
  const [rows] = await db.query(
    `SELECT pt.*, pg.provider, pg.secret_key_encrypted, pg.config_json
     FROM payment_transactions pt
     JOIN payment_gateways pg ON pg.id = pt.payment_gateway_id
     WHERE pt.id = ?
     LIMIT 1`,
    [transactionId],
  );
  const tx = rows[0];

  if (!tx) throw new Error('Transaction not found');
  if (tx.gateway_status !== 'succeeded') throw new Error('Can only refund succeeded transactions');

  let gatewayRefundRef = null;

  switch (tx.provider) {
    case 'stripe': {
      const refundResult = await paymentCircuitBreaker.call(() => refundStripe(tx, tx));
      gatewayRefundRef = refundResult.gatewayRefundRef;
      break;
    }
    case 'conekta': {
      const refundResult = await paymentCircuitBreaker.call(() => refundConekta(tx, tx));
      gatewayRefundRef = refundResult.gatewayRefundRef;
      break;
    }
    case 'manual':
      // Offline / manually-recorded payment: DB-only status flip is sufficient.
      break;
    default:
      throw new PaymentGatewayError(
        `Refunds for provider '${tx.provider}' are not yet supported. ` +
        'Process the refund directly with the provider and record it manually.',
      );
  }

  // Only update DB after processor confirms (or for manual, immediately)
  await db.query(
    'UPDATE payment_transactions SET gateway_status = ?, gateway_reference_id = COALESCE(?, gateway_reference_id) WHERE id = ?',
    ['refunded', gatewayRefundRef, transactionId],
  );

  return {
    transaction_id: transactionId,
    status: 'refunded',
    ...(gatewayRefundRef && { gateway_refund_reference: gatewayRefundRef }),
  };
}

/**
 * Get transaction history for a client.
 */
async function getClientTransactions(clientId, organizationId) {
  const [rows] = await db.query(
    'SELECT * FROM payment_transactions WHERE client_id = ? AND organization_id = ? ORDER BY created_at DESC',
    [clientId, organizationId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Webhook Signature Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Stripe webhook signature (Stripe-Signature header).
 *
 * Stripe signs payloads using HMAC-SHA256 with a tolerance window.
 * The header contains: t=<timestamp>,v1=<signature>
 *
 * @param {string} rawBody   - The raw request body string
 * @param {string} sigHeader - Value of the Stripe-Signature header
 * @param {string} secret    - The webhook signing secret (whsec_…)
 * @param {number} [tolerance=300] - Maximum age of the event in seconds
 * @returns {boolean} True if the signature is valid
 */
function verifyStripeSignature(rawBody, sigHeader, secret, tolerance = 300) {
  if (!sigHeader || !secret) return false;

  const parts = {};
  for (const item of sigHeader.split(',')) {
    const [key, value] = item.split('=');
    if (key && value) {
      if (!parts[key]) parts[key] = [];
      parts[key].push(value);
    }
  }

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  // Tolerance check: reject events older than `tolerance` seconds or
  // more than 5 seconds in the future (clock-skew allowance).
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > tolerance || age < -5) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  try {
    return signatures.some(sig =>
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')),
    );
  } catch (_err) {
    return false;
  }
}

/**
 * Verify a Conekta webhook signature (Digest header).
 *
 * Conekta uses HMAC-SHA256 with the webhook key. The Digest header
 * is the hex-encoded HMAC of the raw body.
 *
 * @param {string} rawBody    - The raw request body string
 * @param {string} digestHeader - Value of the Digest header
 * @param {string} secret     - The webhook signing key
 * @returns {boolean} True if the signature is valid
 */
function verifyConektaSignature(rawBody, digestHeader, secret) {
  if (!digestHeader || !secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digestHeader, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch (_err) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook Event Processing
// ---------------------------------------------------------------------------

/**
 * Process an inbound webhook event from a payment provider.
 *
 * Handles deduplication, status mapping, and calls reconcilePayment when
 * a payment is confirmed.
 *
 * @param {object} params
 * @param {string} params.provider       - 'stripe' or 'conekta'
 * @param {string} params.providerEventId - Unique event ID from the provider
 * @param {string} params.eventType      - Provider event type string
 * @param {object} params.payload        - Full event payload (parsed JSON)
 * @param {number} [params.organizationId] - When the webhook arrived on a
 *        gateway-scoped route, restrict transaction matching to that tenant so
 *        one org's webhook can never reconcile another org's transaction.
 * @returns {object} { status, webhookEventId }
 */
async function handleWebhookEvent({ provider, providerEventId, eventType, payload, organizationId }) {
  // Deduplication: check if we already received this event.
  // KNOWN LIMITATION (deferred): the dedup key (and the webhook_events UNIQUE
  // constraint) is global — (provider, provider_event_id), no organization_id.
  // If two DIFFERENT orgs' gateways point at the SAME provider account, the
  // provider fans one event id out to both /:gatewayId endpoints; whichever
  // lands first claims the slot and the other is suppressed as 'duplicate',
  // so the owning org's payment may not reconcile. Making dedup per-org needs a
  // migration to a composite UNIQUE + setting organization_id at insert time
  // (env-var route has no org), so it is tracked as a follow-up rather than
  // rushed here. Normal deployments (one provider account per org) are unaffected.
  const [existing] = await db.query(
    'SELECT id, status FROM webhook_events WHERE provider = ? AND provider_event_id = ?',
    [provider, providerEventId],
  );

  if (existing.length > 0) {
    return { status: 'duplicate', webhookEventId: existing[0].id };
  }

  // Insert the event record
  const [insertResult] = await db.query(
    `INSERT INTO webhook_events (provider, provider_event_id, event_type, payload, status)
     VALUES (?, ?, ?, ?, 'processing')`,
    [provider, providerEventId, eventType, JSON.stringify(payload)],
  );
  const webhookEventId = insertResult.insertId;

  try {
    // Extract the gateway reference ID and new status from the event
    const { gatewayRef, newStatus } = mapProviderEvent(provider, eventType, payload);

    if (!gatewayRef || !newStatus) {
      // Event type we don't handle — mark as ignored
      await db.query(
        'UPDATE webhook_events SET status = \'ignored\', processed_at = NOW() WHERE id = ?',
        [webhookEventId],
      );
      return { status: 'ignored', webhookEventId };
    }

    // Find the matching payment transaction. When the event arrived on a
    // gateway-scoped route, confine the match to that tenant (cross-tenant
    // reconciliation guard); otherwise fall back to the global lookup.
    const [txRows] = organizationId
      ? await db.query(
        'SELECT * FROM payment_transactions WHERE gateway_reference_id = ? AND organization_id = ? LIMIT 1',
        [gatewayRef, organizationId],
      )
      : await db.query(
        'SELECT * FROM payment_transactions WHERE gateway_reference_id = ? LIMIT 1',
        [gatewayRef],
      );

    if (txRows.length === 0) {
      await db.query(
        'UPDATE webhook_events SET status = \'failed\', error_message = \'No matching transaction found\', processed_at = NOW() WHERE id = ?',
        [webhookEventId],
      );
      return { status: 'no_match', webhookEventId };
    }

    const tx = txRows[0];

    // Update the transaction status
    await db.query(
      'UPDATE payment_transactions SET gateway_status = ?, webhook_payload = ? WHERE id = ?',
      [newStatus, JSON.stringify(payload), tx.id],
    );

    // Update the webhook event with the transaction link
    await db.query(
      'UPDATE webhook_events SET organization_id = ?, transaction_id = ?, status = \'processed\', processed_at = NOW() WHERE id = ?',
      [tx.organization_id, tx.id, webhookEventId],
    );

    // Auto-reconciliation for successful payments
    if (newStatus === 'succeeded') {
      await reconcilePayment(tx.id);

      // Cancel any pending retries for this transaction
      try {
        const paymentRetryService = require('./paymentRetryService');
        await paymentRetryService.cancelRetries({ transactionId: tx.id });
      } catch (cancelErr) {
        logger.error({ cancelErr, transactionId: tx.id }, 'Failed to cancel payment retries after webhook success');
      }
    }

    // Auto-create a chargeback record when a dispute is received — §2.5.3
    if (newStatus === 'disputed') {
      try {
        // payment_transactions.currency is NOT NULL so the fallback should
        // never fire — but when it does, use the org's currency, never 'USD'.
        const cbCurrency = tx.currency
          || await require('../models/Organization').getCurrency(tx.organization_id);
        await db.query(
          `INSERT INTO chargebacks
             (organization_id, payment_id, gateway, gateway_dispute_id, amount, currency, reason_code, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'received')
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [
            tx.organization_id,
            tx.id,
            provider,
            gatewayRef,
            tx.amount,
            cbCurrency,
            eventType,
          ],
        );
        logger.info({ transactionId: tx.id, provider, gatewayRef }, 'Chargeback auto-created from webhook');
      } catch (chargebackErr) {
        logger.error({ chargebackErr, transactionId: tx.id }, 'Failed to auto-create chargeback from webhook');
      }
    }

    logger.info({ provider, eventType, transactionId: tx.id }, 'Webhook event processed');

    return { status: 'processed', webhookEventId, transactionId: tx.id, newStatus };
  } catch (err) {
    await db.query(
      'UPDATE webhook_events SET status = \'failed\', error_message = ?, processed_at = NOW() WHERE id = ?',
      [err.message, webhookEventId],
    );
    throw err;
  }
}

/**
 * Map a provider-specific event type to a gateway reference ID and a
 * normalized transaction status.
 */
function mapProviderEvent(provider, eventType, payload) {
  if (provider === 'stripe') {
    const obj = payload.data?.object || {};
    const gatewayRef = obj.id || null;

    const statusMap = {
      'payment_intent.succeeded': 'succeeded',
      'payment_intent.payment_failed': 'failed',
      'charge.refunded': 'refunded',
      'charge.dispute.created': 'disputed',
    };

    // For charge events, the gateway reference may be the payment_intent
    const ref = eventType.startsWith('charge.')
      ? (obj.payment_intent || obj.id)
      : gatewayRef;

    return { gatewayRef: ref, newStatus: statusMap[eventType] || null };
  }

  if (provider === 'conekta') {
    const obj = payload.data?.object || {};
    const gatewayRef = obj.id || null;

    const statusMap = {
      'order.paid': 'succeeded',
      'order.payment_failed': 'failed',
      'charge.refunded': 'refunded',
      'charge.chargeback.created': 'disputed',
    };

    return { gatewayRef, newStatus: statusMap[eventType] || null };
  }

  return { gatewayRef: null, newStatus: null };
}

// ---------------------------------------------------------------------------
// Auto-reconciliation
// ---------------------------------------------------------------------------

/**
 * When a payment transaction is confirmed as succeeded, find the corresponding
 * invoice (via the payment_transactions → client linkage) and:
 *  1. Mark the invoice as 'paid' if the amounts match
 *  2. Credit the client balance ledger
 *
 * This is intentionally best-effort — failures are logged but don't block
 * webhook processing.
 */
async function reconcilePayment(transactionId) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.execute('SELECT * FROM payment_transactions WHERE id = ? FOR UPDATE', [transactionId]);
    const tx = txRows[0];
    if (!tx) {
      await conn.rollback();
      return;
    }

    // Find the oldest unpaid invoice for this client whose total matches
    const [invoices] = await conn.execute(
      `SELECT * FROM invoices
       WHERE client_id = ? AND organization_id = ? AND status = 'issued'
       ORDER BY due_date ASC LIMIT 1
       FOR UPDATE`,
      [tx.client_id, tx.organization_id],
    );

    if (invoices.length === 0) {
      await conn.rollback();
      return;
    }

    const invoice = invoices[0];
    const txAmount = parseFloat(tx.amount);
    const invoiceTotal = parseFloat(invoice.total);

    if (Math.abs(txAmount - invoiceTotal) > RECONCILE_AMOUNT_TOLERANCE) {
      await conn.rollback();
      return;
    }

    // Mark invoice as paid
    await conn.execute(
      'UPDATE invoices SET status = \'paid\' WHERE id = ?',
      [invoice.id],
    );

    // Credit client balance ledger
    await conn.execute(
      `INSERT INTO client_balance_ledger
       (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'credit', ?, ?, 'payment_transaction', ?, ?)`,
      [tx.client_id, tx.organization_id, tx.amount, tx.currency, tx.id,
        `Gateway payment ${tx.gateway_reference_id}`],
    );

    await conn.commit();
    logger.info({ transactionId, invoiceId: invoice.id }, 'Payment auto-reconciled');
  } catch (err) {
    await conn.rollback();
    // Reconciliation is best-effort; don't fail the webhook
    logger.error({ err, transactionId }, 'Auto-reconciliation failed');
  } finally {
    conn.release();
  }
}

module.exports = {
  getActiveGateway,
  loadGatewayWebhookContext,
  charge,
  refund,
  getClientTransactions,
  chargeStripe,
  chargeConekta,
  checkIdempotencyKey,
  storeIdempotencyKey,
  verifyStripeSignature,
  verifyConektaSignature,
  handleWebhookEvent,
  reconcilePayment,
  paymentCircuitBreaker,
};
