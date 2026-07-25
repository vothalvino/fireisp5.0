// =============================================================================
// FireISP 5.0 — WhatsApp identity service
// =============================================================================
// The trust layer beneath the WhatsApp bot: normalize phone numbers, mint and
// verify short-lived linking/step-up codes (hashed, single-use, rate-limited),
// bind a phone number to a client, and resolve an inbound number back to a
// bound client. See docs/whatsapp-support-design.md.
//
// Security posture:
//   - Only sha256(code + server pepper) is ever stored — never the plaintext
//     code (mirrors clients.portal_reset_token_hash). The pepper makes a stolen
//     whatsapp_verifications row useless for offline brute force of the short
//     numeric codes.
//   - Code comparison is constant-time.
//   - At most ONE active binding per phone number install-wide (the inbound
//     webhook has no org context, so a sender must resolve to exactly one
//     client). Enforced by the whatsapp_links.active_phone UNIQUE and a
//     revoke-then-insert transaction here.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

const PORTAL_CODE_LENGTH = 8; // phone-agnostic lookup — larger space
const EMAIL_CODE_LENGTH  = 6; // delivered to a second channel (email)

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw phone / WhatsApp sender id to E.164 (`+<digits>`).
 *
 * Handles the Mexican mobile quirk: WhatsApp historically prefixes MX mobiles
 * with a `1` after the country code (521XXXXXXXXXX, 13 digits). Canonical E.164
 * for MX is 52 + 10 digits, so we drop that legacy `1` — this makes the two
 * forms WhatsApp may deliver for the same physical number converge to one key.
 *
 * @param {string} raw            e.g. "whatsapp:+5215512345678", "55 1234 5678"
 * @param {string} [defaultCountry='MX']
 * @returns {string|null} E.164 string, or null if unparseable
 */
function normalizeE164(raw, defaultCountry = config.whatsapp.defaultCountry) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/^whatsapp:/i, '').trim();
  const hadPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // Strip an international access prefix (00 34... -> 34...).
  if (digits.startsWith('00')) digits = digits.slice(2);

  if ((defaultCountry || '').toUpperCase() === 'MX') {
    // Bare 10-digit national number with no country code -> assume MX (+52).
    if (!hadPlus && digits.length === 10) digits = `52${digits}`;
    // Legacy MX mobile 521 + 10 digits -> drop the 1.
    if (digits.startsWith('521') && digits.length === 13) digits = `52${digits.slice(3)}`;
  }

  return `+${digits}`;
}

// ---------------------------------------------------------------------------
// Code generation / hashing
// ---------------------------------------------------------------------------

/** Cryptographically-random numeric code of the given length (no modulo bias). */
function generateNumericCode(length) {
  const code = crypto.randomInt(0, 10 ** length);
  return String(code).padStart(length, '0');
}

/** sha256(code + server pepper) hex. */
function hashCode(code) {
  return crypto.createHash('sha256')
    .update(String(code) + config.whatsapp.otpPepper)
    .digest('hex');
}

/** Constant-time hex-digest comparison. */
function hexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// ---------------------------------------------------------------------------
// Verifications (linking / step-up codes)
// ---------------------------------------------------------------------------

/**
 * Has this phone requested too many email-linking codes recently?
 * Guards the email-OTP path against mail-bombing / enumeration timing.
 */
async function emailCodeBudgetExceeded(phone) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_verifications
      WHERE phone_e164 = ? AND purpose = 'link_email'
        AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [phone],
  );
  return (rows[0]?.n || 0) >= config.whatsapp.maxCodesPerHour;
}

/**
 * Mint a verification code and persist only its hash.
 * @returns {Promise<string>} the plaintext code (caller delivers it out-of-band)
 */
async function createVerification({ organizationId = null, phone = null, purpose, clientId = null, channel, length, ttlMinutes = config.whatsapp.linkCodeTtlMinutes }) {
  const code = generateNumericCode(length);
  await db.query(
    `INSERT INTO whatsapp_verifications
       (organization_id, phone_e164, purpose, client_id, code_hash, channel, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, (NOW() + INTERVAL ? MINUTE))`,
    [organizationId, phone, purpose, clientId, hashCode(code), channel, ttlMinutes],
  );
  return code;
}

/**
 * Mint a portal linking code for an authenticated portal client. Phone is
 * unknown at mint time (the client may message from any number), so the code is
 * verified later by value, not by phone.
 */
function createPortalLinkCode({ organizationId, clientId }) {
  return createVerification({
    organizationId,
    clientId,
    phone: null,
    purpose: 'link_portal',
    channel: 'portal',
    length: PORTAL_CODE_LENGTH,
  });
}

/**
 * Verify a code tied to a specific phone + purpose (email-OTP, step-up).
 * Increments attempts on mismatch and refuses once the attempt ceiling is hit.
 * @returns {Promise<{ok:boolean, reason?:string, clientId?:number, organizationId?:number}>}
 */
async function verifyPhoneCode({ phone, purpose, code }) {
  const [rows] = await db.query(
    `SELECT id, client_id, organization_id, code_hash, attempts
       FROM whatsapp_verifications
      WHERE phone_e164 = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose],
  );
  const v = rows[0];
  if (!v) return { ok: false, reason: 'no_pending' };
  if (v.attempts >= config.whatsapp.maxCodeAttempts) return { ok: false, reason: 'locked' };

  if (!hexEqual(hashCode(code), v.code_hash)) {
    await db.query('UPDATE whatsapp_verifications SET attempts = attempts + 1 WHERE id = ?', [v.id]);
    return { ok: false, reason: 'mismatch' };
  }
  await db.query('UPDATE whatsapp_verifications SET consumed_at = NOW() WHERE id = ?', [v.id]);
  return { ok: true, clientId: v.client_id, organizationId: v.organization_id };
}

/**
 * Verify a portal linking code by value (phone-agnostic). The code hash carries
 * the server pepper, and codes are short-lived + single-use; the bot layer adds
 * a per-phone attempt throttle on top of this.
 *
 * If two clients happen to mint the SAME code within the window (a collision —
 * no attacker required), we refuse to bind rather than guess a client, which
 * would otherwise cross-tenant mis-bind. Both codes just become unusable until
 * one expires (self-healing); no wrong binding is ever created.
 * @returns {Promise<{ok:boolean, reason?:string, clientId?:number, organizationId?:number}>}
 */
async function verifyPortalCode({ code }) {
  const [rows] = await db.query(
    `SELECT id, client_id, organization_id
       FROM whatsapp_verifications
      WHERE purpose = 'link_portal' AND code_hash = ? AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 2`,
    [hashCode(code)],
  );
  if (rows.length === 0) return { ok: false, reason: 'no_match' };
  if (rows.length > 1) return { ok: false, reason: 'ambiguous' };
  const v = rows[0];
  await db.query('UPDATE whatsapp_verifications SET consumed_at = NOW() WHERE id = ?', [v.id]);
  return { ok: true, clientId: v.client_id, organizationId: v.organization_id };
}

/** Count a client's still-pending portal linking codes minted in the last hour. */
async function pendingPortalCodeCount(clientId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_verifications
      WHERE client_id = ? AND purpose = 'link_portal' AND consumed_at IS NULL
        AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [clientId],
  );
  return rows[0]?.n || 0;
}

/** Has this client been sent too many email linking codes recently (target-inbox budget)? */
async function clientEmailCodeBudgetExceeded(clientId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_verifications
      WHERE client_id = ? AND purpose = 'link_email'
        AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [clientId],
  );
  return (rows[0]?.n || 0) >= config.whatsapp.maxCodesPerHour;
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/**
 * Bind a phone number to a client. Revokes any existing active binding for the
 * same phone (install-wide) first, transactionally, so re-linking a number to a
 * new client works and the active_phone UNIQUE never blocks a legitimate rebind.
 * @returns {Promise<{id:number}>}
 */
async function bindNumber({ organizationId = null, clientId, phone, via }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE whatsapp_links SET status = 'revoked', revoked_at = NOW()
        WHERE active_phone = ?`,
      [phone],
    );
    const [ins] = await conn.execute(
      `INSERT INTO whatsapp_links
         (organization_id, client_id, phone_e164, bound_via, status, bound_at)
       VALUES (?, ?, ?, ?, 'active', NOW())`,
      [organizationId, clientId, phone, via],
    );
    await conn.commit();
    return { id: ins.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Resolve an inbound phone number to its active binding (install-wide).
 * @returns {Promise<{clientId:number, organizationId:number|null, linkId:number}|null>}
 */
async function resolveBinding(phone) {
  const [rows] = await db.query(
    `SELECT id, client_id, organization_id FROM whatsapp_links
      WHERE active_phone = ? LIMIT 1`,
    [phone],
  );
  const l = rows[0];
  if (!l) return null;
  return { clientId: l.client_id, organizationId: l.organization_id, linkId: l.id };
}

/** Mark the bound number as seen (best-effort; failure is non-fatal). */
async function touchBinding(linkId) {
  try {
    await db.query('UPDATE whatsapp_links SET last_seen_at = NOW() WHERE id = ?', [linkId]);
  } catch (err) {
    logger.warn({ err, linkId }, 'whatsapp: touchBinding failed');
  }
}

/**
 * List a client's active bindings (for the portal "Connect WhatsApp" screen).
 * Numbers are masked by the caller before display.
 */
async function listClientLinks(clientId) {
  const [rows] = await db.query(
    `SELECT id, phone_e164, bound_via, bound_at, last_seen_at
       FROM whatsapp_links
      WHERE client_id = ? AND status = 'active'
      ORDER BY bound_at DESC`,
    [clientId],
  );
  return rows;
}

/** Revoke a client's binding by id (client-initiated unlink). Scoped to the client. */
async function revokeLink({ clientId, linkId }) {
  const [res] = await db.query(
    `UPDATE whatsapp_links SET status = 'revoked', revoked_at = NOW()
      WHERE id = ? AND client_id = ? AND status = 'active'`,
    [linkId, clientId],
  );
  return res.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Inbound message log / dedup
// ---------------------------------------------------------------------------

/**
 * Redact digit runs (linking codes, OTPs, phone/account numbers) before an
 * inbound message body is persisted — the raw text can contain the code the
 * user just typed, and codes must never land in the DB in plaintext.
 */
function redactSecrets(text) {
  if (!text) return text;
  return String(text).replace(/\d{4,}/g, (m) => '•'.repeat(m.length));
}

/**
 * Record an inbound message. Returns { isNew } — false when the provider
 * redelivered a message we already processed (dedup on provider_message_id).
 * The stored body is redacted; the caller passes the original text to the bot.
 */
async function recordInbound({ provider, providerMessageId, phone, toNumber = null, body = null, organizationId = null, clientId = null }) {
  const [res] = await db.query(
    `INSERT IGNORE INTO whatsapp_inbound_messages
       (organization_id, client_id, provider, provider_message_id, phone_e164, to_number, body, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [organizationId, clientId, provider, providerMessageId, phone, toNumber, redactSecrets(body)],
  );
  return { isNew: res.affectedRows > 0 };
}

/** Backfill the resolved org/client onto an inbound row once the sender is bound. */
async function setInboundOwner({ provider, providerMessageId, clientId, organizationId }) {
  try {
    await db.query(
      `UPDATE whatsapp_inbound_messages SET client_id = ?, organization_id = ?
        WHERE provider = ? AND provider_message_id = ?`,
      [clientId, organizationId, provider, providerMessageId],
    );
  } catch (err) {
    logger.warn({ err }, 'whatsapp: setInboundOwner failed');
  }
}

/** Recent inbound-message count from a phone — a coarse per-phone abuse throttle. */
async function recentInboundCount(phone, minutes = 60) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_inbound_messages
      WHERE phone_e164 = ? AND received_at > (NOW() - INTERVAL ? MINUTE)`,
    [phone, minutes],
  );
  return rows[0]?.n || 0;
}

module.exports = {
  normalizeE164,
  generateNumericCode,
  hashCode,
  hexEqual,
  emailCodeBudgetExceeded,
  clientEmailCodeBudgetExceeded,
  createVerification,
  createPortalLinkCode,
  pendingPortalCodeCount,
  verifyPhoneCode,
  verifyPortalCode,
  bindNumber,
  resolveBinding,
  touchBinding,
  listClientLinks,
  revokeLink,
  recordInbound,
  redactSecrets,
  setInboundOwner,
  recentInboundCount,
  PORTAL_CODE_LENGTH,
  EMAIL_CODE_LENGTH,
};
