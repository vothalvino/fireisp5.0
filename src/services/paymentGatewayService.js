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
const logger = require('../utils/logger');

// Default idempotency key TTL: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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

  const [txResult] = await db.query(
    `INSERT INTO payment_transactions
     (organization_id, gateway_id, client_id, amount, currency, description, gateway_status, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [organizationId, gateway.id, clientId, amount, currency || 'MXN', description, idempotencyKey || null],
  );

  const transactionId = txResult.insertId;

  try {
    let result;

    switch (gateway.provider) {
      case 'stripe':
        result = await chargeStripe(gateway, amount, currency || 'MXN', description, paymentMethodToken);
        break;
      case 'conekta':
        result = await chargeConekta(gateway, amount, currency || 'MXN', description, paymentMethodToken);
        break;
      default:
        // Generic / manual — mark as succeeded with placeholder reference
        result = { gatewayRef: `${gateway.provider}_${Date.now()}`, status: 'succeeded' };
        break;
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

  const secretKey = gateway.secret_key_encrypted; // Decrypted at app layer in production
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

  const secretKey = gateway.secret_key_encrypted;
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
 * Refund a payment transaction.
 */
async function refund(transactionId) {
  const [rows] = await db.query('SELECT * FROM payment_transactions WHERE id = ?', [transactionId]);
  const tx = rows[0];

  if (!tx) throw new Error('Transaction not found');
  if (tx.gateway_status !== 'succeeded') throw new Error('Can only refund succeeded transactions');

  await db.query(
    'UPDATE payment_transactions SET gateway_status = ? WHERE id = ?',
    ['refunded', transactionId],
  );

  return { transaction_id: transactionId, status: 'refunded' };
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

  // Tolerance check: reject events older than `tolerance` seconds
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > tolerance) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return signatures.some(sig =>
    crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')),
  );
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
 * @returns {object} { status, webhookEventId }
 */
async function handleWebhookEvent({ provider, providerEventId, eventType, payload }) {
  // Deduplication: check if we already received this event
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

    // Find the matching payment transaction
    const [txRows] = await db.query(
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
  try {
    const [txRows] = await db.query('SELECT * FROM payment_transactions WHERE id = ?', [transactionId]);
    const tx = txRows[0];
    if (!tx) return;

    // Find the oldest unpaid invoice for this client whose total matches
    const [invoices] = await db.query(
      `SELECT * FROM invoices
       WHERE client_id = ? AND organization_id = ? AND status = 'issued'
       ORDER BY due_date ASC LIMIT 1`,
      [tx.client_id, tx.organization_id],
    );

    if (invoices.length === 0) return;

    const invoice = invoices[0];
    const txAmount = parseFloat(tx.amount);
    const invoiceTotal = parseFloat(invoice.total);

    // Only auto-reconcile if amounts match (within rounding tolerance)
    if (Math.abs(txAmount - invoiceTotal) > 0.01) return;

    // Mark invoice as paid
    await db.query(
      'UPDATE invoices SET status = \'paid\' WHERE id = ?',
      [invoice.id],
    );

    // Credit client balance ledger
    await db.query(
      `INSERT INTO client_balance_ledger
       (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
       VALUES (?, ?, 'credit', ?, ?, 'payment_transaction', ?, ?)`,
      [tx.client_id, tx.organization_id, tx.amount, tx.currency, tx.id,
        `Gateway payment ${tx.gateway_reference_id}`],
    );

    logger.info({ transactionId, invoiceId: invoice.id }, 'Payment auto-reconciled');
  } catch (err) {
    // Reconciliation is best-effort; don't fail the webhook
    logger.error({ err, transactionId }, 'Auto-reconciliation failed');
  }
}

module.exports = {
  getActiveGateway,
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
};
