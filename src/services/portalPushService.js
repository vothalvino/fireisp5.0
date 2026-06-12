// =============================================================================
// FireISP 5.0 — Portal Push Notification Service (§11.5)
// =============================================================================
// Sends Web Push notifications to a client's active portal subscriptions.
//
// Environment variables:
//   VAPID_PUBLIC_KEY   — Base64url-encoded VAPID public key
//   VAPID_PRIVATE_KEY  — Base64url-encoded VAPID private key
//   VAPID_SUBJECT      — mailto: or https: contact URI (required by Web Push)
//
// When VAPID keys are not configured, dispatch() is a no-op and logs a warning.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'portalPushService' });

// Lazy-load web-push so the module can be required even in test environments
// where web-push is not fully configured.
let webPush = null;
let vapidConfigured = false;

function getWebPush() {
  if (webPush) return webPush;
  webPush = require('web-push');

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || '';

  if (publicKey && privateKey && subject) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } else {
    logger.warn(
      'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set — Web Push dispatch is disabled',
    );
  }
  return webPush;
}

/**
 * Event types and the corresponding notify_* column.
 * @type {Record<string, string>}
 */
const NOTIFY_FLAG = {
  billing: 'notify_billing',
  outage: 'notify_outage',
  ticket: 'notify_ticket',
};

/**
 * Send a Web Push notification to all active subscriptions of a client,
 * filtered by the notify_* preference flag for the given event type.
 *
 * @param {object} opts
 * @param {number}        opts.clientId       - Client whose subscriptions to target
 * @param {'billing'|'outage'|'ticket'} opts.eventType - Controls notify_* filtering
 * @param {object}        opts.payload        - Notification payload (title, body, url?)
 * @param {string}        [opts.payload.title]
 * @param {string}        [opts.payload.body]
 * @param {string}        [opts.payload.url]
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function dispatch({ clientId, eventType, payload }) {
  const wp = getWebPush();
  if (!vapidConfigured) {
    logger.debug({ clientId, eventType }, 'Web Push skipped: VAPID not configured');
    return { sent: 0, failed: 0 };
  }

  const notifyColumn = NOTIFY_FLAG[eventType];
  if (!notifyColumn) {
    logger.warn({ eventType }, 'Unknown push event type');
    return { sent: 0, failed: 0 };
  }

  // Fetch active subscriptions that have opted in to this event type
  const [rows] = await db.query(
    `SELECT id, endpoint, p256dh, auth
     FROM portal_push_subscriptions
     WHERE client_id = ? AND ${notifyColumn} = 1 AND deleted_at IS NULL`,
    [clientId],
  );

  if (!rows.length) return { sent: 0, failed: 0 };

  const pushPayload = JSON.stringify({
    title: payload.title || 'FireISP',
    body: payload.body || '',
    url: payload.url || '/',
  });

  let sent = 0;
  let failed = 0;

  for (const sub of rows) {
    try {
      await wp.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload,
      );
      // Update last_sent_at on success
      await db.query(
        'UPDATE portal_push_subscriptions SET last_sent_at = NOW() WHERE id = ?',
        [sub.id],
      );
      sent++;
    } catch (err) {
      // 410 Gone = subscription expired; mark it deleted
      if (err.statusCode === 410) {
        await db.query(
          'UPDATE portal_push_subscriptions SET deleted_at = NOW() WHERE id = ?',
          [sub.id],
        ).catch(() => {});
        logger.debug({ subscriptionId: sub.id }, 'Push subscription expired (410), removed');
      } else {
        logger.warn({ err, subscriptionId: sub.id, clientId, eventType }, 'Web Push send failed');
      }
      failed++;
    }
  }

  logger.debug({ clientId, eventType, sent, failed }, 'Portal push dispatch complete');
  return { sent, failed };
}

module.exports = { dispatch };
