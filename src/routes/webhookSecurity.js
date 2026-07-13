// =============================================================================
// FireISP 5.0 — Webhook Security Routes (§17)
// Covers: webhook signing verification, delivery logs
// =============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Webhook Signing Verification
// ---------------------------------------------------------------------------

// GET /verify-signing — return webhook signing verification docs and status
router.get('/verify-signing', async (req, res, next) => {
  try {
    res.json({
      data: {
        algorithm: 'HMAC-SHA256',
        header_name: 'X-FireISP-Signature',
        signature_format: 'sha256=<hex-digest>',
        description: 'FireISP signs all outbound webhook payloads using HMAC-SHA256. Verify the X-FireISP-Signature header against your webhook secret to authenticate the request.',
        verification_steps: [
          '1. Extract the signature from the X-FireISP-Signature header (format: sha256=<hex>)',
          '2. Compute HMAC-SHA256 of the raw request body using your webhook secret',
          '3. Use a timing-safe comparison (e.g., crypto.timingSafeEqual) to compare the computed digest with the received signature',
          '4. If they match, the webhook is authentic',
        ],
        example: {
          header: 'X-FireISP-Signature: sha256=abc123...',
          node_snippet: "const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex'); const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(received));",
        },
        status: 'active',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /verify-signature — verify a webhook signature
// Body: { signature, secret, payload } → returns { valid: boolean }
router.post('/verify-signature', async (req, res, next) => {
  try {
    const { signature, secret, payload } = req.body;

    if (!signature || !secret || !payload) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'signature, secret, and payload are required',
        },
      });
    }

    // Remove "sha256=" prefix if present
    const receivedHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    const computedHex = crypto
      .createHmac('sha256', secret)
      .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
      .digest('hex');

    let valid = false;
    try {
      valid = crypto.timingSafeEqual(
        Buffer.from(computedHex, 'hex'),
        Buffer.from(receivedHex, 'hex'),
      );
    } catch (_e) {
      // Mismatched buffer lengths → invalid
      valid = false;
    }

    res.json({ valid });
  } catch (err) {
    next(err);
  }
});

// GET /delivery-logs — list webhook delivery logs for org
router.get('/delivery-logs', async (req, res, next) => {
  try {
    // webhook_deliveries has no organization_id column — org scoping goes
    // through the parent webhooks row via webhook_id.
    const [rows] = await db.query(
      `SELECT wd.*
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       WHERE w.organization_id = ?
       ORDER BY wd.id DESC LIMIT 100`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
