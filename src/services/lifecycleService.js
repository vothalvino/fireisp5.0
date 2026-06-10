// =============================================================================
// FireISP 5.0 — Customer Lifecycle Service
// =============================================================================
// Implements isp-platform-features.md §1.2 "Customer Lifecycle":
//   • convertLead          — materialise a won lead into a client record
//   • generateOrderNumber  — sequential, org-scoped service-order references
//   • seedDefaultTasks     — onboarding checklist for a new service order
//   • transitionOrder      — enforce the service-order state machine and emit a
//                            welcome notification when an order is activated
//   • churnReport          — monthly churn rate from contract status changes
//   • atRiskClients        — predictive churn alerts (overdue / suspended)
//   • winbackTargets       — cancelled-customer cohorts for a win-back campaign
// =============================================================================

const db = require('../config/database');
const Lead = require('../models/Lead');
const Client = require('../models/Client');
const ServiceOrder = require('../models/ServiceOrder');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'lifecycle' });
const { ValidationError, NotFoundError } = require('../utils/errors');

// Default onboarding checklist applied to every new service order.
const DEFAULT_ONBOARDING_TASKS = [
  { task_key: 'contract_signed', label: 'Contract signed', sort_order: 1 },
  { task_key: 'payment_verified', label: 'Payment method verified', sort_order: 2 },
  { task_key: 'equipment_received', label: 'Equipment received', sort_order: 3 },
  { task_key: 'installation_scheduled', label: 'Installation scheduled', sort_order: 4 },
];

/**
 * Generate the next sequential service-order number for an organization,
 * e.g. SO-000123. Counts existing rows (including soft-deleted) to avoid reuse.
 *
 * @param {object} conn - DB connection or pool exposing query()
 * @param {number|null} orgId
 */
async function generateOrderNumber(conn, orgId) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM service_orders WHERE organization_id <=> ?',
    [orgId ?? null],
  );
  const next = Number(rows[0].cnt) + 1;
  return `SO-${String(next).padStart(6, '0')}`;
}

/**
 * Insert the default onboarding checklist for a service order.
 *
 * @param {object} conn - DB connection exposing query()
 * @param {number} orderId
 */
async function seedDefaultTasks(conn, orderId) {
  for (const task of DEFAULT_ONBOARDING_TASKS) {
    await conn.query(
      `INSERT IGNORE INTO service_order_tasks (service_order_id, task_key, label, sort_order)
       VALUES (?, ?, ?, ?)`,
      [orderId, task.task_key, task.label, task.sort_order],
    );
  }
}

/**
 * Convert a won lead into a client record (transactional). Marks the lead as
 * won and links it to the created client.
 *
 * @param {number} leadId
 * @param {number|null} orgId
 * @param {object} [overrides] - Optional client field overrides (e.g. client_type)
 * @returns {Promise<{ lead: object, client: object }>}
 */
async function convertLead(leadId, orgId = null, overrides = {}) {
  const lead = await Lead.findById(leadId, orgId);
  if (!lead) throw new NotFoundError('Lead');
  if (lead.converted_client_id) {
    throw new ValidationError('Lead has already been converted to a client');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const clientData = {
      organization_id: orgId ?? lead.organization_id ?? null,
      name: lead.name,
      email: lead.email || null,
      phone: lead.phone || null,
      client_type: overrides.client_type || (lead.company ? 'business' : 'residential'),
      address: lead.address || null,
      city: lead.city || null,
      state: lead.state || null,
      zip_code: lead.zip_code || null,
      latitude: lead.latitude || null,
      longitude: lead.longitude || null,
      status: 'active',
    };

    const cols = Object.keys(clientData).filter(k => clientData[k] !== null && clientData[k] !== undefined);
    const [ins] = await conn.query(
      `INSERT INTO clients (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => clientData[c]),
    );
    const clientId = ins.insertId;

    await conn.query(
      `UPDATE leads SET status = 'won', converted_client_id = ?, converted_at = NOW()
       WHERE id = ?`,
      [clientId, leadId],
    );

    await conn.commit();

    const client = await Client.findById(clientId, orgId);
    const updatedLead = await Lead.findById(leadId, orgId);
    logger.info({ leadId, clientId, orgId }, 'Lead converted to client');
    return { lead: updatedLead, client };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Transition a service order to a new status, enforcing the finite state machine
 * (ServiceOrder.TRANSITIONS). Sets the appropriate timestamp columns and emits
 * `service_order.activated` (welcome notification) when the order is activated.
 *
 * @param {number} orderId
 * @param {string} toStatus - approved | provisioning | activated | cancelled
 * @param {object} [options]
 * @param {number|null} [options.orgId]
 * @param {number|null} [options.userId]
 * @param {number|null} [options.contractId] - Contract to link on activation
 * @returns {Promise<object>} the updated service order
 */
async function transitionOrder(orderId, toStatus, { orgId = null, userId = null, contractId = null } = {}) {
  const order = await ServiceOrder.findById(orderId, orgId);
  if (!order) throw new NotFoundError('Service order');

  const allowed = ServiceOrder.TRANSITIONS[order.status] || [];
  if (!allowed.includes(toStatus)) {
    throw new ValidationError(
      `Invalid service order transition: ${order.status} → ${toStatus}`,
    );
  }

  const updates = { status: toStatus };
  if (toStatus === 'approved') {
    updates.approved_at = new Date();
    updates.approved_by = userId;
  } else if (toStatus === 'activated') {
    updates.activated_at = new Date();
    if (contractId) updates.contract_id = contractId;
  } else if (toStatus === 'cancelled') {
    updates.cancelled_at = new Date();
  }

  const updated = await ServiceOrder.update(orderId, updates, orgId);

  if (toStatus === 'activated') {
    await emitActivation(updated, orgId).catch(err =>
      logger.warn({ err: err.message, orderId }, 'Failed to emit service_order.activated'));
  }

  return updated;
}

/**
 * Emit the `service_order.activated` event (welcome email/SMS) with client context.
 */
async function emitActivation(order, orgId) {
  let client = null;
  if (order.client_id) {
    client = await Client.findById(order.client_id, orgId);
  }
  eventBus.emit('service_order.activated', {
    organizationId: orgId ?? order.organization_id ?? null,
    order,
    client,
  });
}

/**
 * Monthly churn report — new vs churned (cancelled) contracts per month and the
 * churn rate as a percentage of the active base.
 *
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.months=12]
 */
async function churnReport(organizationId, { months = 12 } = {}) {
  const safeMonths = Math.min(Math.max(parseInt(months, 10) || 12, 1), 60);

  const [rows] = await db.queryReplica(`
    SELECT
      DATE_FORMAT(c.created_at, '%Y-%m') AS month,
      SUM(c.status IN ('active', 'suspended')) AS new_contracts,
      SUM(c.status = 'cancelled') AS churned
    FROM contracts c
    WHERE (? IS NULL OR c.organization_id = ?)
      AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
    GROUP BY month
    ORDER BY month DESC
  `, [organizationId, organizationId, safeMonths]);

  const months_ = rows.map(r => {
    const created = Number(r.new_contracts) || 0;
    const churned = Number(r.churned) || 0;
    const base = created + churned;
    const churnRate = base > 0 ? Math.round((churned / base) * 10000) / 100 : 0;
    return { month: r.month, new_contracts: created, churned, churn_rate_pct: churnRate };
  });

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    months: months_,
  };
}

/**
 * Predictive churn alerts — clients at risk based on suspended contracts and
 * overdue invoices. Returns a risk score (0-100) per client, highest first.
 *
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 */
async function atRiskClients(organizationId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const [rows] = await db.queryReplica(`
    SELECT
      cl.id AS client_id,
      cl.name,
      cl.email,
      COUNT(DISTINCT CASE WHEN co.status = 'suspended' THEN co.id END) AS suspended_contracts,
      COUNT(DISTINCT CASE WHEN i.status = 'issued' AND i.due_date < NOW() THEN i.id END) AS overdue_invoices,
      COALESCE(MAX(DATEDIFF(NOW(), i.due_date)), 0) AS max_days_overdue
    FROM clients cl
    LEFT JOIN contracts co ON co.client_id = cl.id
    LEFT JOIN invoices i ON i.client_id = cl.id
    WHERE (? IS NULL OR cl.organization_id = ?)
      AND cl.deleted_at IS NULL
    GROUP BY cl.id, cl.name, cl.email
    HAVING suspended_contracts > 0 OR overdue_invoices > 0
    ORDER BY suspended_contracts DESC, max_days_overdue DESC
    LIMIT ${safeLimit}
  `, [organizationId, organizationId]);

  const clients = rows.map(r => {
    const suspended = Number(r.suspended_contracts) || 0;
    const overdue = Number(r.overdue_invoices) || 0;
    const daysOverdue = Number(r.max_days_overdue) || 0;
    // Weighted risk score, capped at 100.
    let score = suspended * 40 + overdue * 15 + Math.min(daysOverdue, 60) / 2;
    score = Math.min(Math.round(score), 100);
    return {
      client_id: r.client_id,
      name: r.name,
      email: r.email,
      suspended_contracts: suspended,
      overdue_invoices: overdue,
      max_days_overdue: daysOverdue,
      risk_score: score,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    clients,
  };
}

/**
 * Resolve the cancelled-customer cohort targeted by a win-back campaign segment.
 *
 * @param {string} segment - all_cancelled | cancelled_30d | cancelled_90d | high_value
 * @param {number|null} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=500]
 */
async function winbackTargets(segment, organizationId, { limit = 500 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);

  const conditions = ["co.status = 'cancelled'", 'cl.deleted_at IS NULL'];
  const params = [organizationId, organizationId];

  if (segment === 'cancelled_30d') {
    conditions.push('co.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)');
  } else if (segment === 'cancelled_90d') {
    conditions.push('co.updated_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)');
  } else if (segment === 'high_value') {
    conditions.push('COALESCE(co.price_override, p.price, 0) >= 500');
  }

  const [rows] = await db.queryReplica(`
    SELECT DISTINCT cl.id AS client_id, cl.name, cl.email, cl.phone
    FROM contracts co
    JOIN clients cl ON cl.id = co.client_id
    LEFT JOIN plans p ON p.id = co.plan_id
    WHERE (? IS NULL OR co.organization_id = ?)
      AND ${conditions.join(' AND ')}
    ORDER BY cl.id
    LIMIT ${safeLimit}
  `, params);

  return rows;
}

module.exports = {
  DEFAULT_ONBOARDING_TASKS,
  generateOrderNumber,
  seedDefaultTasks,
  convertLead,
  transitionOrder,
  churnReport,
  atRiskClients,
  winbackTargets,
};
