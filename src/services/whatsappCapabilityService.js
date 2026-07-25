// =============================================================================
// FireISP 5.0 — WhatsApp bot capabilities (read-only + report a problem)
// =============================================================================
// Turns a resolved (bound) clientId into the short text answers the bot sends,
// reusing the same data sources as the subscriber portal: computeClientBalance,
// the active-contract/plan query, invoices, and client-level ticket creation.
// All functions are read-only except the two ticket creators (a support ticket
// is low-risk and is the client's own record).
// =============================================================================

const db = require('../config/database');
const { computeClientBalance } = require('./clientBalanceService');

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

module.exports = {
  getActiveContracts,
  balanceText,
  planText,
  invoicesText,
  createProblemTicket,
  createHumanHandoffTicket,
  recentWhatsappTicketCount,
};
