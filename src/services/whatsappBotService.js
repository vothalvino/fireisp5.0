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
const cap = require('./whatsappCapabilityService');

// Coarse per-phone throttle for UNBOUND numbers (binding-attempt flood / code
// brute-force). Legitimate linking is 1-3 messages; 20/hr is generous.
const UNBOUND_MSG_LIMIT_PER_HOUR = 20;
// Bound clients navigate menus, so a looser cap — but still bounds a hijacked or
// abusive bound thread (each message can open at most one ticket).
const BOUND_MSG_LIMIT_PER_HOUR = 40;
// Hard cap on WhatsApp-originated tickets per client per hour (anti ticket-flood).
const WHATSAPP_TICKET_CAP_PER_HOUR = 5;
// Hard cap on WhatsApp-originated write-action requests (Wi-Fi reset, visit) per
// client per hour — bounds a hijacked bound thread spamming password resets.
const WHATSAPP_ACTION_CAP_PER_HOUR = 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MSG = {
  welcome:
    '👋 Hi! I can connect you to your ISP account here on WhatsApp.\n\n' +
    "To verify it's you, reply with your *account email* and I'll send you a code — " +
    'or open your customer portal (Profile → Connect WhatsApp) to get a linking code.',
  emailSent:
    "If that email is on file, I've sent a 6-digit code to it. Reply here with the code to finish connecting.",
  bindOk: (name) => `✅ You're connected${name ? `, ${name}` : ''}! Your account features will be available here soon.`,
  menu: (name) =>
    `Hi${name ? ` ${name}` : ''}! What can I help you with? Reply with a number:\n`
    + '1️⃣ Account balance\n2️⃣ My plan & service\n3️⃣ My invoices\n4️⃣ Report a problem\n'
    + '5️⃣ Reset Wi-Fi password\n6️⃣ Schedule a technician visit\n7️⃣ Talk to a human',
  askProblem: "Please describe the problem in one message and I'll open a ticket for you. (Reply MENU to go back.)",
  pickService: (contracts) =>
    'Which service is this about? Reply with the number:\n'
    + contracts.map((c, i) => `${i + 1}) ${c.label}`).join('\n'),
  pickInvalid: 'Please reply with the number of the service (e.g. 1), or MENU to go back.',
  problemLogged: (id) => `✅ Thanks — I've opened ticket #${id} and our team will follow up. Reply MENU anytime.`,
  humanLogged: (id) => `👍 A team member will reach out. Your reference is ticket #${id}.`,
  ticketCapped: 'You already have open requests with us — our team is on it. Reply MENU for other options.',
  // The §21 engine returns its own answer text; these two frame it. Kept
  // alongside the other bot copy rather than in i18n because whatsappBotService
  // is server-side and speaks one language per install — the copy here is
  // English to match every other string in this file, and translating the whole
  // bot is its own job.
  aiEscalated: "Thanks — I've passed this to our support team and someone will follow up here shortly. Reply MENU anytime.",
  aiMenuHint: 'Reply MENU for the options list, or 7 to talk to a person.',
  // Wi-Fi reset
  wifiConfirm: (emailMasked) =>
    `🔐 I'll set a *new* Wi-Fi password and email it to ${emailMasked} — I never show it here in chat. `
    + 'Your devices will need to reconnect with the new password.\n\nReply *CONFIRM* to proceed, or MENU to cancel.',
  wifiNoEmail:
    'To reset your Wi-Fi password securely I need an email on file to send the new one to. '
    + 'Please add one in your customer portal, or reply 7 to talk to a human.',
  wifiApplied: (emailMasked) =>
    `✅ Done — your new Wi-Fi password has been emailed to ${emailMasked}. `
    + 'Reconnect your devices with it (it may take a few minutes to take effect).',
  wifiFiled: (id) =>
    `✅ Request submitted (#${id}). Our team will set a new Wi-Fi password and contact you shortly.`,
  wifiEmailFailed:
    "I couldn't email your new Wi-Fi password just now, so I did NOT change it (to avoid locking you out). "
    + 'Please try again in a bit, or reply 7 to talk to a human.',
  confirmInvalid: 'Reply *CONFIRM* to proceed, or MENU to cancel.',
  // Technician visit
  askVisitDate: 'What day would you like a technician to visit? Reply with a date (e.g. 2026-08-05). Reply MENU to cancel.',
  visitDateInvalid: 'Please reply with a date like 2026-08-05, or MENU to cancel.',
  askVisitSlot: 'What time works best? Reply:\n1) Morning (8am–12pm)\n2) Afternoon (12pm–5pm)\n3) Evening (5pm–8pm)',
  visitLogged: (id, date, slot) => `✅ Visit requested for ${date} (${slot}) — reference #${id}. We'll confirm the appointment. Reply MENU anytime.`,
  noService: "You don't have an active service on file, so there's nothing to change. Reply 7 to talk to a human.",
  actionCapped: "You've made several requests recently — please wait a bit before trying again, or reply 7 to talk to a human.",
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
    emailTransport.sendEmail({
      to: client.email,
      subject: tpl.subject,
      html: tpl.html,
      organizationId: client.organization_id,
      clientId: client.id,
      messageClass: 'security',
      emailFunction: 'general',
    })
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
  // 1. Already bound? Run the bound-client bot (menu + read-only capabilities).
  const binding = await wa.resolveBinding(phone);
  if (binding) {
    return handleBound({ phone, body, binding });
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

// ---------------------------------------------------------------------------
// Bound-client bot: menu + read-only capabilities + report-a-problem flow
// ---------------------------------------------------------------------------

/**
 * Route a free-text message through the AI support engine.
 *
 * Continuity matters on WhatsApp: a subscriber describes a fault across three
 * messages. The support_conversations id is kept in the bot's own conversation
 * state so follow-ups continue ONE thread rather than opening a new
 * conversation — and therefore a new diagnostic context — per message.
 *
 * channel='whatsapp' is passed through: support_conversations.channel is a
 * free-text VARCHAR defaulting to 'web', so the engine was already
 * channel-aware and nobody had connected the second channel. No migration.
 *
 * THE HANDOFF THRESHOLD IS NOT A NEW DECISION. supportConversationService
 * already owns it (LOW_CONFIDENCE_THRESHOLD, MAX_LOW_CONFIDENCE_MESSAGES, plus
 * explicit human-request / negative-sentiment / billing-dispute triggers).
 * Inventing a second threshold for WhatsApp would mean the same sentence
 * escalates in the portal and not here.
 *
 * Returns the reply text, or null to fall back to the menu. EVERY failure
 * returns null: an LLM outage, a missing provider, a DB error — none of them
 * may surface as an error message to a customer on WhatsApp.
 */
async function tryAiSupport({ phone, orgId, clientId, text, state }) {
  try {
    const support = require('./supportConversationService');
    const priorId = state?.context?.supportConversationId || null;

    let result;
    if (priorId) {
      result = await support.sendMessage({ conversationId: priorId, orgId, content: text, clientId });
    } else {
      result = await support.startConversation({ orgId, clientId, channel: 'whatsapp', message: text });
    }
    if (!result?.conversation) return null;

    const conv = result.conversation;
    const messages = result.messages || [];

    // An escalated conversation gets no AI reply by design, so say a human is
    // coming rather than returning the greeting and looking like a non-answer.
    if (conv.status === 'escalated') {
      await wa.clearConversationState(phone);
      return MSG.aiEscalated;
    }

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant?.content) return null;

    // Remember the thread so the next message continues it.
    await wa.setConversationState(phone, clientId, 'ai_support', { supportConversationId: conv.id });
    return `${lastAssistant.content}\n\n_${MSG.aiMenuHint}_`;
  } catch (err) {
    logger.warn({ err: err.message, clientId }, 'WhatsApp AI support unavailable — falling back to the menu');
    return null;
  }
}

function isMenuCommand(text) {
  return /^\s*(menu|men[uú]|cancel|cancelar|salir|0)\s*$/i.test(text || '');
}

/** Map a bound client's message to an intent. Unknown/greeting -> 'menu'. */
function parseIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^1$|balance|saldo/.test(t)) return 'balance';
  if (/^2$|\bplan\b|servicio|service|velocidad|speed/.test(t)) return 'plan';
  if (/^3$|invoice|factura|recibo|\bbill/.test(t)) return 'invoices';
  if (/^4$|report|problema|reportar|falla|issue|not working|no funciona/.test(t)) return 'report';
  if (/^5$|wi-?fi|contrase|clave|password/.test(t)) return 'wifi';
  if (/^6$|visit|visita|t[eé]cnico|technician|schedule|agenda|cita/.test(t)) return 'visit';
  if (/^7$|human|agente|asesor|person|talk|hablar/.test(t)) return 'human';
  return 'menu';
}

/**
 * Is this free text worth sending to the §21 AI support engine?
 *
 * The bot is a fixed numbered menu, so "mi internet se cae cada noche desde el
 * martes" fell through parseIntent to 'menu' and got a list of numbers back —
 * the channel most Mexican customers prefer had the least capable support path,
 * while a full intent-classification + diagnostics engine sat unused next door.
 *
 * The bar is deliberately conservative. A bare greeting, a stray number or a
 * one-word reply is menu navigation, not a support question, and routing those
 * to an LLM would spend money to answer "hola" worse than the menu does.
 */
function isFreeTextQuestion(text) {
  const t = String(text || '').trim();
  if (t.length < 12) return false;                       // "hola", "1", "gracias"
  if (/^\d+$/.test(t)) return false;                     // menu selection
  if (/^\s*(hola|hi|hello|buenas|buenos d[ií]as|gracias|thanks|ok|s[ií]|no)\b/i.test(t)
      && t.split(/\s+/).length <= 3) return false;       // short pleasantry
  return t.split(/\s+/).length >= 3;                     // a sentence, not a keyword
}

function isConfirmCommand(text) {
  return /^\s*(confirm|confirmar|s[ií]|yes)\s*$/i.test(text || '');
}

function parseSlot(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^1$|morning|mañana|manana/.test(t)) return 'morning';
  if (/^2$|afternoon|tarde/.test(t)) return 'afternoon';
  if (/^3$|evening|noche/.test(t)) return 'evening';
  return null;
}
function parseVisitDate(text) {
  const m = String(text || '').match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!m) return null;
  const [iso, y, mo, d] = m;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject overflow days that V8 silently rolls over (Feb 30 -> Mar 2): the
  // round-trip must match the literal components.
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() + 1 !== Number(mo) || dt.getUTCDate() !== Number(d)) return null;
  // Reject past dates (a visit can't be scheduled in the past); today is allowed.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (dt < today) return null;
  return iso;
}

/** Masked email on file, or null when none — gates the Wi-Fi reset (must deliver the new PSK). */
async function clientEmailMasked(clientId) {
  try {
    const [rows] = await db.query('SELECT email FROM clients WHERE id = ? LIMIT 1', [clientId]);
    const email = rows[0]?.email;
    return email ? cap.maskEmail(email) : null;
  } catch (_e) {
    return null;
  }
}

async function startReport(phone, clientId) {
  const contracts = await cap.getActiveContracts(clientId);
  if (contracts.length > 1) {
    await wa.setConversationState(phone, clientId, 'await_contract_pick', { contracts });
    return { reply: MSG.pickService(contracts) };
  }
  await wa.setConversationState(phone, clientId, 'await_problem_desc', { contract: contracts[0] || null });
  return { reply: MSG.askProblem };
}

async function startWifiReset(phone, clientId) {
  const contracts = await cap.getActiveContracts(clientId);
  if (contracts.length === 0) return { reply: MSG.noService };
  // Must be able to deliver the new PSK out-of-band, or the client is locked out.
  const emailMasked = await clientEmailMasked(clientId);
  if (!emailMasked) return { reply: MSG.wifiNoEmail };
  if (contracts.length > 1) {
    await wa.setConversationState(phone, clientId, 'await_wifi_pick', { contracts, emailMasked });
    return { reply: MSG.pickService(contracts) };
  }
  await wa.setConversationState(phone, clientId, 'await_wifi_confirm', { contract: contracts[0] || null, emailMasked });
  return { reply: MSG.wifiConfirm(emailMasked) };
}

async function applyWifiReset(phone, clientId, orgId, contract) {
  await wa.clearConversationState(phone);
  if (await cap.recentServiceRequestCount(clientId, 'wifi_password_change') >= WHATSAPP_ACTION_CAP_PER_HOUR) {
    return { reply: MSG.actionCapped, clientId };
  }
  // resetWifiPassword delivers the new PSK by email FIRST and only applies on
  // confirmed delivery, so its result is authoritative — never claim "emailed"
  // unless it actually was.
  const r = await cap.resetWifiPassword({ orgId, clientId, contract });
  if (!r.ok) {
    if (r.reason === 'no_email') return { reply: MSG.wifiNoEmail, clientId };
    if (r.reason === 'contract_gone') return { reply: MSG.noService, clientId };
    return { reply: MSG.wifiEmailFailed, clientId }; // email_failed
  }
  if (r.applied) return { reply: MSG.wifiApplied(r.emailMasked), clientId };
  return { reply: MSG.wifiFiled(r.requestId), clientId };
}

async function startVisit(phone, clientId) {
  const contracts = await cap.getActiveContracts(clientId);
  if (contracts.length === 0) return { reply: MSG.noService };
  if (contracts.length > 1) {
    await wa.setConversationState(phone, clientId, 'await_visit_pick', { contracts });
    return { reply: MSG.pickService(contracts) };
  }
  await wa.setConversationState(phone, clientId, 'await_visit_date', { contract: contracts[0] || null });
  return { reply: MSG.askVisitDate };
}

async function handleBound({ phone, body, binding }) {
  const clientId = binding.clientId;
  const orgId = binding.organizationId;
  const text = String(body || '').trim();

  await wa.touchBinding(binding.linkId);

  if (isUnlinkCommand(text)) {
    await wa.revokeLink({ clientId, linkId: binding.linkId });
    await wa.clearConversationState(phone);
    return { reply: MSG.unlinked, clientId };
  }

  // Throttle a flooding/hijacked bound thread (bounds ticket creation too).
  if (await wa.recentInboundCount(phone, 60) > BOUND_MSG_LIMIT_PER_HOUR) {
    return { reply: MSG.cooldown, clientId };
  }

  let state = await wa.getConversationState(phone);
  // A number can be re-bound to a DIFFERENT client (recycled number / staff
  // re-link). Never carry a prior client's flow state across that rebind, or a
  // stale contract context would leak into the new client's ticket.
  if (state && state.clientId !== null && state.clientId !== undefined
      && Number(state.clientId) !== Number(clientId)) {
    await wa.clearConversationState(phone);
    state = null;
  }

  // MENU/cancel always escapes an in-progress flow.
  if (state && isMenuCommand(text)) {
    await wa.clearConversationState(phone);
    return { reply: MSG.menu(await clientFirstName(clientId)), clientId };
  }

  // In an active flow — the message is the flow's input.
  if (state && state.state === 'await_contract_pick') {
    const contracts = state.context?.contracts || [];
    const chosen = contracts[parseInt(text.replace(/\D/g, ''), 10) - 1];
    if (!chosen) return { reply: MSG.pickInvalid, clientId };
    await wa.setConversationState(phone, clientId, 'await_problem_desc', { contract: chosen });
    return { reply: MSG.askProblem, clientId };
  }
  if (state && state.state === 'await_problem_desc') {
    await wa.clearConversationState(phone);
    if (await cap.recentWhatsappTicketCount(clientId) >= WHATSAPP_TICKET_CAP_PER_HOUR) {
      return { reply: MSG.ticketCapped, clientId };
    }
    const id = await cap.createProblemTicket({ orgId, clientId, description: text, contract: state.context?.contract || null });
    return { reply: MSG.problemLogged(id), clientId };
  }
  if (state && state.state === 'await_wifi_pick') {
    const contracts = state.context?.contracts || [];
    const chosen = contracts[parseInt(text.replace(/\D/g, ''), 10) - 1];
    if (!chosen) return { reply: MSG.pickInvalid, clientId };
    await wa.setConversationState(phone, clientId, 'await_wifi_confirm', { contract: chosen, emailMasked: state.context?.emailMasked });
    return { reply: MSG.wifiConfirm(state.context?.emailMasked || 'your email on file'), clientId };
  }
  if (state && state.state === 'await_wifi_confirm') {
    if (!isConfirmCommand(text)) return { reply: MSG.confirmInvalid, clientId };
    return applyWifiReset(phone, clientId, orgId, state.context?.contract || null);
  }
  if (state && state.state === 'await_visit_pick') {
    const contracts = state.context?.contracts || [];
    const chosen = contracts[parseInt(text.replace(/\D/g, ''), 10) - 1];
    if (!chosen) return { reply: MSG.pickInvalid, clientId };
    await wa.setConversationState(phone, clientId, 'await_visit_date', { contract: chosen });
    return { reply: MSG.askVisitDate, clientId };
  }
  if (state && state.state === 'await_visit_date') {
    const date = parseVisitDate(text);
    if (!date) return { reply: MSG.visitDateInvalid, clientId };
    await wa.setConversationState(phone, clientId, 'await_visit_slot', { contract: state.context?.contract || null, date });
    return { reply: MSG.askVisitSlot, clientId };
  }
  if (state && state.state === 'await_visit_slot') {
    const slot = parseSlot(text);
    if (!slot) return { reply: MSG.askVisitSlot, clientId };
    await wa.clearConversationState(phone);
    if (await cap.recentServiceRequestCount(clientId, 'visit_schedule') >= WHATSAPP_ACTION_CAP_PER_HOUR) {
      return { reply: MSG.actionCapped, clientId };
    }
    const id = await cap.scheduleVisit({ orgId, clientId, contract: state.context?.contract || null, preferredDate: state.context?.date, slot });
    return { reply: MSG.visitLogged(id, state.context?.date, slot), clientId };
  }

  // No active flow. Before falling back to the numbered menu, give real
  // free text to the §21 engine — intent classification, diagnostics against
  // the actual account and connection, and confidence-scored escalation. The
  // menu stays as the fallback for everything else.
  // FREE TEXT WINS OVER KEYWORD MATCHING, and that ordering is the point.
  // parseIntent matches bare words anywhere in the message, so "no tengo
  // servicio desde ayer" hits `servicio` and "y tambien se cae el wifi" hits
  // `wifi` — both would have been answered with a canned menu response instead
  // of reaching the engine. Someone who writes a SENTENCE wants an answer, not
  // a plan summary; someone who types `2` wants the menu.
  if (isFreeTextQuestion(text)) {
    const aiReply = await tryAiSupport({ phone, orgId, clientId, text, state });
    if (aiReply) return { reply: aiReply, clientId };
    // Fall through to the menu when the engine is unavailable — a bot that
    // apologises for an internal error is worse than one that offers a menu.
  }

  // No active flow — parse an intent.
  switch (parseIntent(text)) {
    case 'balance': return { reply: await cap.balanceText(orgId, clientId), clientId };
    case 'plan': return { reply: await cap.planText(clientId), clientId };
    case 'invoices': return { reply: await cap.invoicesText(clientId), clientId };
    case 'report': return { ...(await startReport(phone, clientId)), clientId };
    case 'wifi': return { ...(await startWifiReset(phone, clientId)), clientId };
    case 'visit': return { ...(await startVisit(phone, clientId)), clientId };
    case 'human': {
      await wa.clearConversationState(phone);
      if (await cap.recentWhatsappTicketCount(clientId) >= WHATSAPP_TICKET_CAP_PER_HOUR) {
        return { reply: MSG.ticketCapped, clientId };
      }
      const id = await cap.createHumanHandoffTicket({ orgId, clientId });
      return { reply: MSG.humanLogged(id), clientId };
    }
    default: return { reply: MSG.menu(await clientFirstName(clientId)), clientId };
  }
}

module.exports = { handleInbound, UNBOUND_MSG_LIMIT_PER_HOUR };
