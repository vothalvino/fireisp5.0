// =============================================================================
// FireISP 5.0 — WhatsApp bot (identity / binding phase)
// =============================================================================
// The conversation brain for an inbound WhatsApp message. In this phase it only
// establishes identity: it links a phone number to a client via a portal code
// or an email OTP, and recognizes an already-bound number. Account capabilities
// (balance, report-a-problem, ...) arrive in the next phase and will replace the
// "already connected" placeholder with a capability menu.
//
// Anti-enumeration: an email that isn't on file gets the SAME reply as one that
// is (the code is only actually sent for a unique match). We never confirm to an
// unverified number whether an account exists.
// =============================================================================

const config = require('../config');
const db = require('../config/database');
const logger = require('../utils/logger');
const wa = require('./whatsappService');

// Coarse per-phone throttle for UNBOUND numbers (binding-attempt flood / code
// brute-force). Legitimate linking is 1-3 messages; 20/hr is generous.
const UNBOUND_MSG_LIMIT_PER_HOUR = 20;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MSG = {
  welcome:
    '👋 Hi! I can connect you to your ISP account here on WhatsApp.\n\n' +
    "To verify it's you, reply with your *account email* and I'll send you a code — " +
    'or open your customer portal (Profile → Connect WhatsApp) to get a linking code.',
  emailSent:
    "If that email is on file, I've sent a 6-digit code to it. Reply here with the code to finish connecting.",
  bindOk: (name) => `✅ You're connected${name ? `, ${name}` : ''}! Your account features will be available here soon.`,
  alreadyConnected: (name) =>
    `✅ Your number is already connected${name ? `, ${name}` : ''}. Account features are coming here soon.\n\nReply UNLINK to disconnect this number.`,
  unlinked: 'Your WhatsApp number has been disconnected from your account. Reply with your email anytime to reconnect.',
  codeBad: "That code isn't valid or has expired. Reply with your email for a new one, or get a fresh code from your portal.",
  codeMismatch: "That code doesn't match. Check it and try again, or reply with your email for a new one.",
  locked: 'Too many incorrect attempts. Please wait a bit, then request a new code.',
  cooldown: "You've sent a lot of messages recently — please wait a few minutes and try again.",
};

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// A code message is ONLY a code — both the portal deep-link and the OTP flow send
// the code as the whole message. Require the trimmed body to be digits (with
// optional spaces/dashes), 6-8 digits total. Anchoring avoids swallowing a
// numeric-suffixed email (carlos123456@x.com) or a texted phone number as a code.
function extractCode(body) {
  const t = String(body || '').trim();
  if (!/^[\d\s-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 8 ? digits : null;
}

function isUnlinkCommand(body) {
  return /^\s*(unlink|desvincular|desconectar)\s*$/i.test(body || '');
}

async function clientFirstName(clientId) {
  try {
    const [rows] = await db.query('SELECT name FROM clients WHERE id = ? LIMIT 1', [clientId]);
    return firstName(rows[0]?.name);
  } catch (_e) {
    return '';
  }
}

/**
 * Best-effort email-OTP send. Resolves EXACTLY ONE non-deleted client by email
 * (0 or >1 matches -> no send, to avoid cross-tenant ambiguity and enumeration).
 * Never throws; the caller has already produced the uniform reply.
 */
async function maybeSendEmailOtp({ phone, email }) {
  try {
    if (await wa.emailCodeBudgetExceeded(phone)) return;
    const [clients] = await db.query(
      'SELECT id, organization_id, name, email FROM clients WHERE email = ? AND deleted_at IS NULL LIMIT 2',
      [email],
    );
    if (clients.length !== 1) return;
    const client = clients[0];
    // Per-target-inbox budget (the per-phone budget above protects the sender,
    // not the victim's inbox against a number-cycling attacker).
    if (await wa.clientEmailCodeBudgetExceeded(client.id)) return;

    const code = await wa.createVerification({
      organizationId: client.organization_id,
      phone,
      purpose: 'link_email',
      clientId: client.id,
      channel: 'email',
      length: wa.EMAIL_CODE_LENGTH,
    });

    const emailTransport = require('./emailTransport');
    const templates = require('../views/emailTemplates');
    const tpl = templates.whatsappLinkCodeEmail({
      userName: client.name,
      code,
      expiresIn: `${config.whatsapp.linkCodeTtlMinutes} minutes`,
    });
    emailTransport.sendEmail({ to: client.email, subject: tpl.subject, html: tpl.html })
      .then((r) => { if (!r || !r.success) logger.warn('whatsapp: link-code email failed to send'); })
      .catch((e) => logger.error({ err: e }, 'whatsapp: link-code email threw'));
  } catch (err) {
    logger.error({ err }, 'whatsapp: maybeSendEmailOtp failed');
  }
}

/**
 * Handle one inbound message. Performs binding side effects and returns the text
 * to reply with.
 * @param {object} opts
 * @param {string} opts.phone  - normalized E.164
 * @param {string} opts.body
 * @returns {Promise<{reply: string, clientId?: number}>}
 */
async function handleInbound({ phone, body }) {
  // 1. Already bound?
  const binding = await wa.resolveBinding(phone);
  if (binding) {
    await wa.touchBinding(binding.linkId);
    if (isUnlinkCommand(body)) {
      await wa.revokeLink({ clientId: binding.clientId, linkId: binding.linkId });
      return { reply: MSG.unlinked, clientId: binding.clientId };
    }
    const name = await clientFirstName(binding.clientId);
    return { reply: MSG.alreadyConnected(name), clientId: binding.clientId };
  }

  // 2. Unbound — throttle binding attempts per phone.
  const recent = await wa.recentInboundCount(phone, 60);
  if (recent > UNBOUND_MSG_LIMIT_PER_HOUR) {
    return { reply: MSG.cooldown };
  }

  const trimmed = String(body || '').trim();
  const code = extractCode(trimmed);

  // 2a. A code. Portal codes are 8 digits, email OTPs 6 — route by length so a
  // pending email OTP can't shadow a valid portal code, and typing one never
  // pollutes the other's attempt counter.
  if (code) {
    if (code.length === wa.PORTAL_CODE_LENGTH) {
      const portalAttempt = await wa.verifyPortalCode({ code });
      if (portalAttempt.ok) {
        await wa.bindNumber({ organizationId: portalAttempt.organizationId, clientId: portalAttempt.clientId, phone, via: 'portal' });
        return { reply: MSG.bindOk(await clientFirstName(portalAttempt.clientId)), clientId: portalAttempt.clientId };
      }
      return { reply: MSG.codeBad };
    }
    const emailAttempt = await wa.verifyPhoneCode({ phone, purpose: 'link_email', code });
    if (emailAttempt.ok) {
      await wa.bindNumber({ organizationId: emailAttempt.organizationId, clientId: emailAttempt.clientId, phone, via: 'email_otp' });
      return { reply: MSG.bindOk(await clientFirstName(emailAttempt.clientId)), clientId: emailAttempt.clientId };
    }
    if (emailAttempt.reason === 'locked') return { reply: MSG.locked };
    if (emailAttempt.reason === 'mismatch') return { reply: MSG.codeMismatch };
    // no pending email OTP — last resort, a portal code of a non-standard length.
    const portalAttempt = await wa.verifyPortalCode({ code });
    if (portalAttempt.ok) {
      await wa.bindNumber({ organizationId: portalAttempt.organizationId, clientId: portalAttempt.clientId, phone, via: 'portal' });
      return { reply: MSG.bindOk(await clientFirstName(portalAttempt.clientId)), clientId: portalAttempt.clientId };
    }
    return { reply: MSG.codeBad };
  }

  // 2b. An email — start email-OTP (uniform reply regardless of match).
  if (EMAIL_RE.test(trimmed)) {
    await maybeSendEmailOtp({ phone, email: trimmed });
    return { reply: MSG.emailSent };
  }

  // 2c. Anything else — instructions.
  return { reply: MSG.welcome };
}

module.exports = { handleInbound, UNBOUND_MSG_LIMIT_PER_HOUR };
