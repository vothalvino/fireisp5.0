// =============================================================================
// FireISP 5.0 — WhatsApp inbound webhook verification + parsing
// =============================================================================
// Provider-agnostic seam for the two WhatsApp inbound transports:
//   meta   — Meta WhatsApp Cloud API. JSON body, X-Hub-Signature-256 =
//            'sha256=' + HMAC_SHA256(app_secret, RAW body). GET verification
//            challenge (hub.mode/hub.verify_token/hub.challenge).
//   twilio — Twilio WhatsApp. form-urlencoded body, X-Twilio-Signature =
//            base64(HMAC_SHA1(auth_token, full_url + sorted(k+v concat))).
//
// Fail closed (route enforces): unverifiable signature -> 401; provider secret
// not configured -> 503; malformed payload -> 400. Mirrors paymentWebhooks.js.
// =============================================================================

const crypto = require('crypto');
const config = require('../config');

/** Which inbound provider is active. Explicit config wins; else infer from secrets. */
function detectProvider() {
  const p = String(config.whatsapp.provider || 'auto').toLowerCase();
  if (p === 'meta' || p === 'twilio') return p;
  if (config.whatsapp.appSecret) return 'meta';
  if (process.env.TWILIO_AUTH_TOKEN) return 'twilio';
  return null;
}

/** The signing secret for a provider, or '' when unconfigured. */
function providerSecret(provider) {
  if (provider === 'meta') return config.whatsapp.appSecret || '';
  if (provider === 'twilio') return process.env.TWILIO_AUTH_TOKEN || '';
  return '';
}

function isConfigured(provider) {
  return Boolean(providerSecret(provider));
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyMetaSignature(rawBody, header, secret) {
  if (!header || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(rawBody || '', 'utf8').digest('hex');
  // Constant-time; equal-length required by timingSafeEqual.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Reconstruct the exact public URL Twilio signed. Twilio signs the URL it was
 * configured to POST to (scheme + host + path + query). Behind a proxy we honor
 * an explicit override, then X-Forwarded-Proto/Host.
 */
function twilioRequestUrl(req) {
  if (process.env.WHATSAPP_WEBHOOK_PUBLIC_URL) {
    // Configured base + this request's path (query preserved via originalUrl).
    return process.env.WHATSAPP_WEBHOOK_PUBLIC_URL.replace(/\/+$/, '') + req.originalUrl;
  }
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}${req.originalUrl}`;
}

function verifyTwilioSignature(req, secret) {
  const header = req.headers['x-twilio-signature'];
  if (!header || typeof header !== 'string') return false;
  const url = twilioRequestUrl(req);
  // data = url + for each POST param sorted by key: key + value (no separators).
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', secret).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Verify the request signature for the given provider (secret must be present). */
function verifyRequestSignature(provider, req) {
  const secret = providerSecret(provider);
  if (!secret) return false;
  if (provider === 'meta') {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    return verifyMetaSignature(rawBody, req.headers['x-hub-signature-256'], secret);
  }
  if (provider === 'twilio') return verifyTwilioSignature(req, secret);
  return false;
}

// ---------------------------------------------------------------------------
// Meta GET verification challenge
// ---------------------------------------------------------------------------

/**
 * Handle Meta's webhook verification handshake (GET). Returns the challenge
 * string to echo back on success, or null to 403.
 */
function safeStrEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function metaChallenge(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const expected = config.whatsapp.verifyToken;
  if (mode === 'subscribe' && expected && safeStrEqual(token, expected)) return challenge;
  return null;
}

// ---------------------------------------------------------------------------
// Inbound payload parsing -> normalized message list
// ---------------------------------------------------------------------------

/**
 * Extract user text messages from a provider payload as a normalized list:
 *   [{ providerMessageId, from, to, body }]
 * Non-message events (delivery/read receipts, Meta status callbacks) yield [].
 */
function parseInboundMessages(provider, req) {
  if (provider === 'meta') return parseMeta(req.body);
  if (provider === 'twilio') return parseTwilio(req.body);
  return [];
}

function parseMeta(body) {
  const out = [];
  if (!body || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const to = value.metadata?.display_phone_number || value.metadata?.phone_number_id || null;
      for (const m of value.messages || []) {
        // Only text messages carry a body we can act on in this phase.
        const bodyText = m.type === 'text' ? (m.text?.body || '') : '';
        out.push({ providerMessageId: m.id, from: m.from, to, body: bodyText });
      }
    }
  }
  return out;
}

function parseTwilio(body) {
  if (!body || !body.MessageSid || !body.From) return [];
  return [{
    providerMessageId: body.MessageSid,
    from: body.From,           // "whatsapp:+5215512345678" — normalized downstream
    to: body.To || null,
    body: body.Body || '',
  }];
}

module.exports = {
  detectProvider,
  providerSecret,
  isConfigured,
  verifyRequestSignature,
  verifyMetaSignature,
  verifyTwilioSignature,
  metaChallenge,
  parseInboundMessages,
};
