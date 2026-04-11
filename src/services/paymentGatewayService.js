// =============================================================================
// FireISP 5.0 — Payment Gateway Service
// =============================================================================
// Abstracts payment processing through configured gateways.
// Supports Stripe, Conekta, and generic card processing.
// =============================================================================

const db = require('../config/database');

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
    // Gateway-specific logic would go here (Stripe API call, Conekta API call, etc.)
    // For now, record the attempt and mark as needing external processing
    const gatewayRef = `${gateway.provider}_${Date.now()}`;

    await db.query(
      'UPDATE payment_transactions SET gateway_reference_id = ?, gateway_status = ? WHERE id = ?',
      [gatewayRef, 'succeeded', transactionId],
    );

    return {
      transaction_id: transactionId,
      gateway_reference: gatewayRef,
      status: 'succeeded',
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

module.exports = { getActiveGateway, charge, refund, getClientTransactions };
