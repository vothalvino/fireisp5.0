// =============================================================================
// FireISP 5.0 — WhatsApp outbound (bot replies)
// =============================================================================
// Sends a bot reply back to a WhatsApp number through whichever provider is
// active. Self-contained (not smsTransport) for two reasons: replies must work
// for UNBOUND senders where we have no organization_id yet (sms_logs.org is NOT
// NULL), and Meta Cloud API outbound is a different transport smsTransport does
// not implement. When an org IS known (a bound client), the send is also logged
// to sms_logs for history, best-effort.
//
// Replies are only ever sent in response to an inbound message, so they fall
// inside the provider's customer-service window — free-form text, no template.
// =============================================================================

const https = require('https');
const { URLSearchParams } = require('url');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/** POST helper returning { sid, status } or throwing. */
function httpsPost({ hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_e) { /* non-JSON */ }
        if (res.statusCode >= 400) {
          const msg = parsed.error?.message || parsed.message || `HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.code = String(parsed.error?.code || res.statusCode);
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('WhatsApp send timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendViaTwilio({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM || ''}`;
  const post = new URLSearchParams({ To: `whatsapp:${to}`, From: from, Body: body }).toString();
  return httpsPost({
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${sid}/Messages.json`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(post),
    },
    body: post,
  }).then((r) => ({ sid: r.sid || null }));
}

function sendViaMeta({ to, body }) {
  const { phoneNumberId, accessToken, graphVersion } = config.whatsapp;
  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body },
  });
  return httpsPost({
    hostname: 'graph.facebook.com',
    path: `/${graphVersion}/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
  }).then((r) => ({ sid: r.messages?.[0]?.id || null }));
}

/**
 * Send a WhatsApp reply. Never throws — returns { success, messageId?, error? }.
 * @param {object} opts
 * @param {'twilio'|'meta'} opts.provider
 * @param {string} opts.to              - E.164 destination (no 'whatsapp:' prefix)
 * @param {string} opts.body
 * @param {number|null} [opts.organizationId]  - when set, the send is logged to sms_logs
 * @param {number|null} [opts.clientId]
 */
async function sendReply({ provider, to, body, organizationId = null, clientId = null }) {
  let result;
  try {
    let sent;
    if (provider === 'meta') {
      if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
        throw new Error('Meta WhatsApp outbound not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)');
      }
      sent = await sendViaMeta({ to, body });
    } else if (provider === 'twilio') {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio WhatsApp outbound not configured');
      }
      sent = await sendViaTwilio({ to, body });
    } else {
      throw new Error(`Unsupported WhatsApp provider: ${provider}`);
    }
    result = { success: true, sid: sent.sid, error: null };
  } catch (err) {
    result = { success: false, sid: null, error: err.message || String(err) };
    logger.warn({ err, to, provider }, 'whatsapp: outbound reply failed');
  }

  // Log to sms_logs only when we know the org (bound client) — org is NOT NULL.
  if (organizationId) {
    try {
      await db.query(
        `INSERT INTO sms_logs
           (organization_id, client_id, phone_number, channel, direction, message_body,
            provider, provider_message_id, status, error_message, sent_at)
         VALUES (?, ?, ?, 'whatsapp', 'outbound', ?, ?, ?, ?, ?, ?)`,
        [
          organizationId, clientId, to, body, provider, result.sid,
          result.success ? 'sent' : 'failed',
          result.success ? null : result.error,
          result.success ? new Date() : null,
        ],
      );
    } catch (logErr) {
      logger.warn({ err: logErr }, 'whatsapp: sms_logs write failed');
    }
  }

  return { success: result.success, messageId: result.sid, error: result.error };
}

module.exports = { sendReply };
