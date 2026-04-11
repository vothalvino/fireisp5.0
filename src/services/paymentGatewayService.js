// =============================================================================
// FireISP 5.0 — Payment Gateway Service
// =============================================================================
// Abstracts payment processing through configured gateways.
// Supports Stripe, Conekta, and generic card processing.
// =============================================================================

const db = require('../config/database');
const { URLSearchParams } = require('url');

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
 * Charge a payment through the gateway.
 * Routes to provider-specific logic based on the gateway's provider field.
 */
async function charge({ organizationId, clientId, amount, currency, description, paymentMethodToken }) {
  const gateway = await getActiveGateway(organizationId);
  if (!gateway) {
    throw new Error('No active payment gateway configured');
  }

  const [txResult] = await db.query(
    `INSERT INTO payment_transactions
     (organization_id, gateway_id, client_id, amount, currency, description, gateway_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [organizationId, gateway.id, clientId, amount, currency || 'MXN', description],
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

    return {
      transaction_id: transactionId,
      gateway_reference: result.gatewayRef,
      status: result.status,
      provider: gateway.provider,
    };
  } catch (err) {
    await db.query(
      'UPDATE payment_transactions SET gateway_status = ?, raw_response = ? WHERE id = ?',
      ['failed', err.message, transactionId],
    );

    return {
      transaction_id: transactionId,
      status: 'failed',
      error: err.message,
    };
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

module.exports = { getActiveGateway, charge, refund, getClientTransactions, chargeStripe, chargeConekta };
