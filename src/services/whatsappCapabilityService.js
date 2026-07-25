// =============================================================================
// FireISP 5.0 — WhatsApp bot capabilities (read-only + report a problem)
// =============================================================================
// Turns a resolved (bound) clientId into the short text answers the bot sends,
// reusing the same data sources as the subscriber portal: computeClientBalance,
// the active-contract/plan query, invoices, and client-level ticket creation.
// All functions are read-only except the two ticket creators (a support ticket
// is low-risk and is the client's own record).
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { computeClientBalance } = require('./clientBalanceService');
const portalServiceRequests = require('./portalServiceRequestService');
const logger = require('../utils/logger');

function money(n) {
  return Math.abs(Number(n) || 0).toFixed(2);
}

function ymd(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

/**
 * Active contracts for a client, with a human label for the multi-service picker.
 * @returns {Promise<Array<{id:number, status:string, planName:string, down:number, up:number, label:string}>>}
 */
async function getActiveContracts(clientId) {
  const [rows] = await db.query(
    `SELECT c.id, c.status, c.connection_type,
            p.name AS plan_name, p.download_speed_mbps AS down, p.upload_speed_mbps AS up,
            s.name AS site_name
       FROM contracts c
       JOIN plans p ON p.id = c.plan_id
       LEFT JOIN sites s ON s.id = c.site_id
      WHERE c.client_id = ? AND c.status = 'active' AND c.deleted_at IS NULL
      ORDER BY c.id`,
    [clientId],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    planName: r.plan_name,
    down: r.down,
    up: r.up,
    label: r.site_name ? `${r.plan_name} — ${r.site_name}` : `${r.plan_name} (#${r.id})`,
  }));
}

/** Balance + next due date. */
async function balanceText(orgId, clientId) {
  const { balance, currency } = await computeClientBalance(orgId, clientId);
  const [[{ next_due }]] = await db.query(
    `SELECT MIN(due_date) AS next_due FROM invoices
      WHERE client_id = ? AND status IN ('issued', 'overdue') AND deleted_at IS NULL`,
    [clientId],
  );
  if (Number(balance) > 0.005) {
    const due = next_due ? ` Your next payment is due ${ymd(next_due)}.` : '';
    return `💳 Your account balance is *${money(balance)} ${currency}*.${due}`;
  }
  if (Number(balance) < -0.005) {
    return `✅ You're all paid up — you have a credit of *${money(balance)} ${currency}*.`;
  }
  return `✅ You're all paid up. Balance: *0.00 ${currency}*.`;
}

/** Plan(s) + service status. */
async function planText(clientId) {
  const contracts = await getActiveContracts(clientId);
  if (contracts.length === 0) {
    return "You don't have an active service on file. If that's unexpected, reply 4 to report it.";
  }
  const lines = contracts.map((c) => {
    const speed = c.down ? ` — ${c.down}/${c.up} Mbps` : '';
    return `• ${c.planName}${speed} — ${c.status}`;
  });
  return `📶 Your service${contracts.length > 1 ? 's' : ''}:\n${lines.join('\n')}`;
}

/** Recent invoices + their payment status. */
async function invoicesText(clientId) {
  const [rows] = await db.query(
    `SELECT invoice_number, total, status, due_date
       FROM invoices
      WHERE client_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 3`,
    [clientId],
  );
  if (rows.length === 0) return 'You have no invoices on file yet.';
  const lines = rows.map((r) => {
    const due = r.due_date ? ` (due ${ymd(r.due_date)})` : '';
    return `• ${r.invoice_number}: ${money(r.total)} — ${r.status}${due}`;
  });
  return `🧾 Your recent invoices:\n${lines.join('\n')}\n\nReply 1 for your current balance.`;
}

/** Open a technical ticket from a reported problem, linked to the chosen contract. */
async function createProblemTicket({ orgId, clientId, description, contract }) {
  const label = contract ? (contract.label || `Contract #${contract.id}`) : null;
  const contractId = contract && contract.id ? contract.id : null;
  const subject = `WhatsApp: reported problem${label ? ` [${label}]` : ''}`.slice(0, 250);
  const body = `${(description || '').trim() || '(no description provided)'}`
    + `${label ? `\n\nService: ${label}` : ''}\n\n(Reported via WhatsApp)`;
  const [r] = await db.query(
    `INSERT INTO tickets (organization_id, client_id, contract_id, subject, description, priority, category, status)
     VALUES (?, ?, ?, ?, ?, 'medium', 'technical', 'open')`,
    [orgId, clientId, contractId, subject, body],
  );
  return r.insertId;
}

/** Count WhatsApp-originated tickets a client opened recently (anti ticket-flood). */
async function recentWhatsappTicketCount(clientId, minutes = 60) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM tickets
      WHERE client_id = ? AND subject LIKE 'WhatsApp:%'
        AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [clientId, minutes],
  );
  return rows[0]?.n || 0;
}

/** Open a general ticket flagging that the customer asked for a human. */
async function createHumanHandoffTicket({ orgId, clientId }) {
  const [r] = await db.query(
    `INSERT INTO tickets (organization_id, client_id, subject, description, priority, category, status)
     VALUES (?, ?, 'WhatsApp: customer requested a human', 'Customer asked to talk to a team member via WhatsApp.', 'medium', 'general', 'open')`,
    [orgId, clientId],
  );
  return r.insertId;
}

// ---------------------------------------------------------------------------
// Write actions (PR 3): Wi-Fi password reset + technician visit
// ---------------------------------------------------------------------------

/** Mask an email for display: j***@example.com */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 1) return s ? `***${s.slice(at)}` : '';
  return `${s[0]}***${s.slice(at)}`;
}

/** A strong, unambiguous Wi-Fi PSK (no look-alike chars), never shown in chat. */
function generateWifiPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  let pw = '';
  for (let i = 0; i < 12; i += 1) pw += alphabet[crypto.randomInt(0, alphabet.length)];
  return pw;
}

/** Confirm the chosen contract still belongs to this client + is active (TOCTOU guard). */
async function contractStillOwned(clientId, contractId) {
  if (!contractId) return true; // no contract targeted (client-level)
  const [rows] = await db.query(
    "SELECT id FROM contracts WHERE id = ? AND client_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1",
    [contractId, clientId],
  );
  return rows.length > 0;
}

/** Deliver the new Wi-Fi password by email — AWAITED and per-org routed. Returns bool. */
async function sendWifiPasswordEmail({ orgId, clientId, client, password }) {
  try {
    const emailTransport = require('./emailTransport');
    const templates = require('../views/emailTemplates');
    const tpl = templates.whatsappWifiPasswordEmail({ userName: client.name, password });
    const r = await emailTransport.sendEmail({
      to: client.email,
      subject: tpl.subject,
      html: tpl.html,
      organizationId: orgId,
      clientId,
      emailFunction: 'general',
    });
    return !!(r && r.success);
  } catch (e) {
    logger.error({ err: e }, 'whatsapp: wifi-password email threw');
    return false;
  }
}

/**
 * Reset a contract's Wi-Fi password. Order matters for safety:
 *  1. re-validate the contract still belongs to this client + is active (it was
 *     cached in conversation state up to ~15 min ago),
 *  2. require a deliverable email (the new PSK is only ever emailed, never shown),
 *  3. DELIVER the new password and confirm it sent — never apply an undelivered
 *     PSK (that would lock the client out of their own Wi-Fi),
 *  4. only then apply it to the CPE (when the contract has a managed device).
 * Returns { ok, reason?, applied?, emailMasked?, requestId? }.
 */
async function resetWifiPassword({ orgId, clientId, contract }) {
  const contractId = contract && contract.id ? contract.id : null;
  if (!(await contractStillOwned(clientId, contractId))) {
    return { ok: false, reason: 'contract_gone' };
  }
  const [crows] = await db.query('SELECT name, email FROM clients WHERE id = ? LIMIT 1', [clientId]);
  const client = crows[0];
  if (!client || !client.email) return { ok: false, reason: 'no_email' };

  const newPassword = generateWifiPassword();
  const [ins] = await db.query(
    `INSERT INTO portal_service_requests
       (organization_id, client_id, contract_id, request_type, status, payload)
     VALUES (?, ?, ?, 'wifi_password_change', 'pending', ?)`,
    [orgId, clientId, contractId, JSON.stringify({ new_password: newPassword, source: 'whatsapp' })],
  );
  const requestId = ins.insertId;

  // Deliver first — abort (leave pending, unapplied) if the email did not send.
  const sent = await sendWifiPasswordEmail({ orgId, clientId, client, password: newPassword });
  if (!sent) return { ok: false, reason: 'email_failed', requestId };

  const { queued } = await portalServiceRequests.queueWifiPasswordCpeTask({ contractId, newPassword, createdBy: null });
  if (queued) {
    await db.query(
      `UPDATE portal_service_requests
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [requestId],
    );
  }
  return { ok: true, applied: queued, requestId, emailMasked: maskEmail(client.email) };
}

/** Count a client's recent service-requests of a type (anti request-flood). */
async function recentServiceRequestCount(clientId, requestType, minutes = 60) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM portal_service_requests
      WHERE client_id = ? AND request_type = ? AND deleted_at IS NULL
        AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [clientId, requestType, minutes],
  );
  return rows[0]?.n || 0;
}

/** File a technician-visit request against the chosen contract. */
async function scheduleVisit({ orgId, clientId, contract, preferredDate, slot, notes }) {
  let contractId = contract && contract.id ? contract.id : null;
  // Re-validate ownership (TOCTOU); if the contract was reassigned, file client-level.
  if (contractId && !(await contractStillOwned(clientId, contractId))) contractId = null;
  const [ins] = await db.query(
    `INSERT INTO portal_service_requests
       (organization_id, client_id, contract_id, request_type, status, payload)
     VALUES (?, ?, ?, 'visit_schedule', 'pending', ?)`,
    [orgId, clientId, contractId, JSON.stringify({ preferred_date: preferredDate, preferred_slot: slot, notes: notes || null, source: 'whatsapp' })],
  );
  return ins.insertId;
}

module.exports = {
  getActiveContracts,
  balanceText,
  planText,
  invoicesText,
  createProblemTicket,
  createHumanHandoffTicket,
  recentWhatsappTicketCount,
  recentServiceRequestCount,
  maskEmail,
  generateWifiPassword,
  resetWifiPassword,
  scheduleVisit,
};
