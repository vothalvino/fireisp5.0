// =============================================================================
// FireISP 5.0 — monthly revenue summary aggregation
// =============================================================================
// Fills revenue_summary, which five queries in reportService read and nothing
// ever wrote. `populate_revenue_summary` returned the string "populated by
// MySQL scheduled event" for an event that was never written — and returning a
// message counts as success, so the task went green nightly while the Churn
// Revenue Impact and Capacity Forecast reports had nothing to work with.
//
// Same shape as networkHealthAggregator (j52), same reasoning: a task in
// taskRunner is testable, logged and fails visibly; a MySQL EVENT is none of
// those.
//
// ── The definitions, because every one of them is a choice ───────────────────
//
// MRR   Contract price normalised to a month. A contract's price is
//       COALESCE(contracts.price_override, plans.price) and its cycle is
//       COALESCE(contracts.billing_cycle, plans.billing_cycle) — the override
//       columns exist on both, and using the plan's price while ignoring the
//       contract's cycle (or vice versa) is the obvious way to get this subtly
//       wrong. An annual contract contributes price/12, not price.
//
// ACTIVE Contracts with status 'active' whose start_date has passed and whose
//       end_date has not, evaluated AT THE END OF THE PERIOD rather than today.
//       Recomputing an old month must not describe it using today's roster.
//
// CHURN Contracts that reached cancelled/terminated/expired with an end_date
//       inside the period. end_date is the only date this schema records for
//       an ending — there is no cancelled_at — so a contract cancelled without
//       one is not counted rather than being attributed to an arbitrary month.
//
// MONEY total_revenue is invoiced in the period (draft/cancelled/void excluded
//       — a draft is not revenue); total_collected is completed payments in
//       the period; total_outstanding is unpaid invoice value AS AT the end of
//       the period, not today, for the same reason as ACTIVE.
//
// CURRENCY One per organisation (Organization.getCurrency). revenue_summary's
//       unique key includes currency, so a future multi-currency org would add
//       rows rather than overwrite — but nothing here sums across currencies,
//       which would be meaningless.
// =============================================================================

const db = require('../config/database');
const Organization = require('../models/Organization');
const logger = require('../utils/logger').child({ service: 'revenueSummaryAggregator' });

/** Monthly-equivalent divisor for each billing cycle. */
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };

const CYCLE_SQL = `
  CASE COALESCE(c.billing_cycle, p.billing_cycle)
    WHEN 'quarterly'   THEN 3
    WHEN 'semi_annual' THEN 6
    WHEN 'annual'      THEN 12
    ELSE 1
  END`;

/**
 * Recompute one month for EVERY active organisation.
 *
 * The seeded scheduled task (migration 123) carries organization_id NULL,
 * meaning "the whole install" — so a null here must fan out, not fail.
 * Requiring a caller-supplied org looked reasonable because
 * revenue_summary.organization_id is NOT NULL, but it would have turned a task
 * that silently did nothing into a task that FAILS every night on every
 * install, which the operator cannot fix without editing the database.
 *
 * @param {number|null} organizationId  null = every active organisation.
 * @param {string} [month]  YYYY-MM-01; defaults to the current month.
 */
async function populate(organizationId = null, month = null) {
  if (organizationId) return populateOne(organizationId, month);

  const [orgs] = await db.query(
    "SELECT id FROM organizations WHERE status = 'active' AND deleted_at IS NULL",
  );
  const results = [];
  for (const org of orgs) {
    // One organisation's bad data must not stop the rest of the install from
    // being summarised — this is a nightly reporting job, not a transaction.
    try {
      results.push(await populateOne(org.id, month));
    } catch (err) {
      logger.warn({ organizationId: org.id, err: err.message }, 'Revenue summary failed for organization');
    }
  }
  return { organizations: results.length, period_date: month || firstOfThisMonth() };
}

/** Recompute one month for one organisation. */
async function populateOne(organizationId, month = null) {
  const periodDate = month || firstOfThisMonth();
  const currency = (await Organization.getCurrency(organizationId)) || 'MXN';

  const [[contracts]] = await db.query(
    `SELECT
       COALESCE(SUM(COALESCE(c.price_override, p.price) / ${CYCLE_SQL}), 0) AS total_mrr,
       COUNT(*)                       AS total_contracts_active,
       COUNT(DISTINCT c.client_id)    AS total_clients_active
     FROM contracts c
     JOIN plans p ON p.id = c.plan_id
    WHERE c.organization_id = ?
      AND c.deleted_at IS NULL
      AND c.status = 'active'
      AND c.start_date <= LAST_DAY(?)
      AND (c.end_date IS NULL OR c.end_date >= LAST_DAY(?))`,
    [organizationId, periodDate, periodDate],
  );

  const [[flow]] = await db.query(
    `SELECT
       SUM(c.start_date BETWEEN ? AND LAST_DAY(?))                       AS new_contracts,
       SUM(c.status IN ('cancelled','terminated','expired')
           AND c.end_date IS NOT NULL
           AND c.end_date BETWEEN ? AND LAST_DAY(?))                     AS churned_contracts
     FROM contracts c
    WHERE c.organization_id = ? AND c.deleted_at IS NULL`,
    [periodDate, periodDate, periodDate, periodDate, organizationId],
  );

  const [[money]] = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(i.total), 0) FROM invoices i
         WHERE i.organization_id = ? AND i.deleted_at IS NULL
           AND i.status NOT IN ('draft','cancelled','void')
           AND i.issue_date BETWEEN ? AND LAST_DAY(?))                   AS total_revenue,
       (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay
         WHERE pay.organization_id = ? AND pay.deleted_at IS NULL
           AND pay.status = 'completed'
           AND pay.payment_date BETWEEN ? AND LAST_DAY(?))               AS total_collected,
       (SELECT COALESCE(SUM(i.total), 0) FROM invoices i
         WHERE i.organization_id = ? AND i.deleted_at IS NULL
           AND i.status IN ('issued','sent','overdue')
           AND i.issue_date <= LAST_DAY(?))                              AS total_outstanding`,
    [
      organizationId, periodDate, periodDate,
      organizationId, periodDate, periodDate,
      organizationId, periodDate,
    ],
  );

  const mrr = Number(contracts.total_mrr) || 0;
  const clients = Number(contracts.total_clients_active) || 0;
  // ARPU is undefined with no clients, not zero — but the column is NOT NULL,
  // so 0 is what the schema allows. Guarded to avoid Infinity/NaN reaching it.
  const arpu = clients > 0 ? Number((mrr / clients).toFixed(2)) : 0;

  await db.query(
    `INSERT INTO revenue_summary
       (organization_id, period_date, total_mrr, total_clients_active,
        total_contracts_active, new_contracts, churned_contracts, arpu,
        total_revenue, total_collected, total_outstanding, currency, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
        total_mrr              = VALUES(total_mrr),
        total_clients_active   = VALUES(total_clients_active),
        total_contracts_active = VALUES(total_contracts_active),
        new_contracts          = VALUES(new_contracts),
        churned_contracts      = VALUES(churned_contracts),
        arpu                   = VALUES(arpu),
        total_revenue          = VALUES(total_revenue),
        total_collected        = VALUES(total_collected),
        total_outstanding      = VALUES(total_outstanding),
        calculated_at          = NOW()`,
    [
      organizationId, periodDate, mrr, clients,
      Number(contracts.total_contracts_active) || 0,
      Number(flow.new_contracts) || 0,
      Number(flow.churned_contracts) || 0,
      arpu,
      Number(money.total_revenue) || 0,
      Number(money.total_collected) || 0,
      Number(money.total_outstanding) || 0,
      currency,
    ],
  );

  const result = {
    period_date: periodDate,
    currency,
    total_mrr: mrr,
    total_clients_active: clients,
    arpu,
  };
  logger.info({ organizationId, ...result }, 'Revenue summary recalculated');
  return result;
}

function firstOfThisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

module.exports = { populate, populateOne, CYCLE_MONTHS, _firstOfThisMonth: firstOfThisMonth };
