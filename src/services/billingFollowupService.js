// =============================================================================
// FireISP 5.0 — Post-install follow-up dispatcher (lead-installation workflow tail)
// =============================================================================
// N days after a service order completes (install done, contract live), the
// billing team gets a follow-up ticket to CALL THE CLIENT: is the service
// working well, are they happy with the install — the courtesy check that
// catches a struggling subscriber in week one instead of at churn time
// (user-specified purpose, 2026-08-04: satisfaction check, not invoice audit).
//
//   * N is PER ORG: the billing_followup_days org setting (settingsCatalog;
//     default 3, 0 disables). Resolved per order at dispatch time, so changing
//     the knob affects orders already waiting.
//   * Exactly once per order: service_orders.billing_followup_ticket_id is
//     both the marker and the audit link, claimed with a guarded UPDATE.
//   * 30-day dispatch window after the due date: an order whose follow-up is
//     more than 30 days overdue is skipped, not spammed — this also keeps the
//     first run after the feature ships from flooding billing with tickets
//     for every historical order.
//
// Runs from taskRunner as 'billing_followup_dispatcher' (hourly seed,
// migration 445). Global sweep — one run serves every organization.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'billingFollowup' });
const { ORG_SETTING_DEFS } = require('./settingsCatalog');

const DISPATCH_WINDOW_DAYS = 30;
const MAX_PER_RUN = 200; // backstop against a pathological backlog

/** Per-org billing_followup_days, catalog default filled in. */
async function loadDelays() {
  const [rows] = await db.query(
    `SELECT organization_id, setting_value FROM organization_settings
     WHERE setting_key = 'billing_followup_days'`,
  );
  const map = new Map();
  for (const r of rows) map.set(r.organization_id ?? 0, Number(r.setting_value));
  return map;
}

function delayFor(map, orgId) {
  const stored = map.get(orgId ?? 0);
  if (stored !== undefined && Number.isInteger(stored) && stored >= 0) return stored;
  return Number(ORG_SETTING_DEFS.billing_followup_days.default);
}

async function dispatch() {
  const delays = await loadDelays();

  // Candidates: completed orders with a client, not yet dispatched, recent
  // enough that SOME delay could still be inside its dispatch window.
  const horizonDays = 90 + DISPATCH_WINDOW_DAYS; // ≥ max configurable delay + window
  const [orders] = await db.query(
    `SELECT so.id, so.organization_id, so.client_id, so.contract_id, so.order_number, so.completed_at,
            c.name AS client_name
     FROM service_orders so
     JOIN clients c ON c.id = so.client_id
     WHERE so.status = 'done' AND so.deleted_at IS NULL
       AND so.billing_followup_ticket_id IS NULL
       AND so.completed_at IS NOT NULL
       AND so.completed_at >= DATE_SUB(NOW(), INTERVAL ${horizonDays} DAY)
       AND c.deleted_at IS NULL
     ORDER BY so.completed_at ASC
     LIMIT ${MAX_PER_RUN}`,
  );

  const now = Date.now();
  let created = 0;
  let skippedExpired = 0;

  for (const order of orders) {
    const days = delayFor(delays, order.organization_id);
    if (days === 0) continue; // disabled for this org

    const dueAt = new Date(order.completed_at).getTime() + days * 86400_000;
    if (now < dueAt) continue; // not due yet
    if (now > dueAt + DISPATCH_WINDOW_DAYS * 86400_000) { skippedExpired += 1; continue; }

    try {
      const [ins] = await db.query(
        `INSERT INTO tickets
           (organization_id, client_id, contract_id, subject, description, category, source, priority, status)
         VALUES (?, ?, ?, ?, ?, 'billing', 'automation', 'medium', 'open')`,
        [
          order.organization_id, order.client_id, order.contract_id,
          `Post-install follow-up — ${order.order_number} (${order.client_name})`,
          `Auto-created ${days} day(s) after installation completed (service order ${order.order_number}).\n`
          + 'Contact the client and confirm: the service is working well (speed/stability as sold), '
          + 'they are happy with the installation, and they know how to reach support and their client portal.',
        ],
      );

      // Claim the order; the ticket id doubles as the audit link. A lost race
      // (another runner already claimed it) removes the duplicate ticket.
      const [claim] = await db.query(
        'UPDATE service_orders SET billing_followup_ticket_id = ? WHERE id = ? AND billing_followup_ticket_id IS NULL',
        [ins.insertId, order.id],
      );
      if (claim.affectedRows === 0) {
        await db.query('UPDATE tickets SET deleted_at = NOW() WHERE id = ?', [ins.insertId]);
        continue;
      }
      created += 1;
    } catch (err) {
      logger.warn({ err: err.message, serviceOrderId: order.id }, 'billing follow-up ticket creation failed');
    }
  }

  logger.info({ examined: orders.length, created, skippedExpired }, 'billing follow-up dispatch complete');
  return { examined: orders.length, created, skipped_expired: skippedExpired };
}

module.exports = { dispatch, DISPATCH_WINDOW_DAYS };
