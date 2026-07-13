// =============================================================================
// FireISP 5.0 — Customer Lifecycle Service
// =============================================================================
// Implements isp-platform-features.md §1.2 "Customer Lifecycle":
//   • convertLead          — materialise a won lead into a client record
//   • nextOrderNumber      — atomic, org-scoped SO-###### sequence (migration 384)
//   • seedDefaultTasks     — onboarding checklist for a new service order
//   • startOrder           — new -> in_process, one transaction: locks the
//                            order row, auto-creates + provisions the contract
//                            for new_install orders (migration 380)
//   • completeOrder        — in_process -> done, one transaction: activates a
//                            pending contract and/or raises an installation
//                            invoice, THEN emits the welcome notification
//                            after commit (migration 380)
//   • cancelOrder          — new/in_process -> cancelled, one transaction:
//                            cancels + deprovisions a still-pending
//                            auto-created contract (migration 380)
//   • churnReport          — monthly churn rate from contract status changes
//   • atRiskClients        — predictive churn alerts (overdue / suspended)
//   • winbackTargets       — cancelled-customer cohorts for a win-back campaign
//
// startOrder/completeOrder/cancelOrder all lock the service_orders row with
// SELECT ... FOR UPDATE and guard their final status UPDATE with a
// WHERE status = '<expected>' clause, so two concurrent calls on the same
// order can never both succeed (the loser's guarded UPDATE affects 0 rows and
// raises a ValidationError instead of double-provisioning/double-invoicing).
// =============================================================================

const db = require('../config/database');
const Lead = require('../models/Lead');
const Client = require('../models/Client');
const ServiceOrder = require('../models/ServiceOrder');
const eventBus = require('./eventBus');
const provisioningService = require('./subscriberProvisioningService');
const billingService = require('./billingService');
const logger = require('../utils/logger').child({ service: 'lifecycle' });
const { ValidationError, NotFoundError, AppError } = require('../utils/errors');

// Default onboarding checklist applied to every new service order.
const DEFAULT_ONBOARDING_TASKS = [
  { task_key: 'contract_signed', label: 'Contract signed', sort_order: 1 },
  { task_key: 'payment_verified', label: 'Payment method verified', sort_order: 2 },
  { task_key: 'equipment_received', label: 'Equipment received', sort_order: 3 },
  { task_key: 'installation_scheduled', label: 'Installation scheduled', sort_order: 4 },
];

/**
 * Atomically allocate the next sequential service-order number for an
 * organization, e.g. SO-000123. Backed by `organization_order_sequences`
 * (migration 384) — a one-row-per-org atomic counter — instead of the old
 * `SELECT COUNT(*) FROM service_orders ...` + 1 pattern, which is a
 * non-locking read: two concurrent callers for the same org could read the
 * same count and both attempt to INSERT the same order_number, hitting the
 * uq_service_orders_org_number unique-key 500. Mirrors
 * billingService.nextInvoiceNumber(conn, orgId) exactly — see that
 * function's doc comment for why the INSERT IGNORE + UPDATE pair is
 * deliberately NOT collapsed into a single `ON DUPLICATE KEY UPDATE`
 * statement.
 *
 * `organization_id` is NULL for single-tenant deployments; the sequence
 * table uses sentinel `0` as its primary key for that bucket.
 *
 * @param {object} conn - An active connection/transaction (must expose
 *   `.query`/`.execute`) — this call is meant to run inside the caller's own
 *   transaction so the order INSERT and the counter advance commit or roll
 *   back together.
 * @param {number|null} orgId
 * @returns {Promise<string>} e.g. "SO-000123"
 */
async function nextOrderNumber(conn, orgId) {
  const bucket = orgId ?? 0;
  await conn.execute(
    'INSERT IGNORE INTO organization_order_sequences (organization_id, next_number) VALUES (?, 1)',
    [bucket],
  );
  await conn.execute(
    `UPDATE organization_order_sequences
        SET next_number = LAST_INSERT_ID(next_number) + 1
      WHERE organization_id = ?`,
    [bucket],
  );
  const [[{ id }]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
  const next = Number(id);
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
 * Emit the `service_order.activated` event (welcome email/SMS) with client context.
 * Always called AFTER the owning transaction has committed, so a notification
 * hook failure can never roll back a billing/provisioning change.
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
 * Build the `AND organization_id = ?` fragment BaseModel itself uses (skip the
 * filter entirely when orgId is null — single-tenant/no active-org context —
 * rather than a NULL-safe `<=>` match, so behaviour matches every other
 * `Model.findById(id, orgId)` call in this codebase).
 */
function appendOrgFilter(sql, params, orgId, column = 'organization_id') {
  if (orgId !== null) {
    return { sql: `${sql} AND ${column} = ?`, params: [...params, orgId] };
  }
  return { sql, params };
}

/**
 * Start a service order: new -> in_process (migration 380). For `new_install`
 * orders with no contract linked yet, this auto-creates and provisions a
 * `pending` contract from the order's resolved client + plan in the SAME
 * transaction as the status transition — the normal flow no longer needs a
 * manual "create contract" step, and a partial failure (e.g. an archived
 * plan) never leaves an order half-started. Auto-converts an unconverted lead
 * so the order always ends up with a client_id.
 *
 * Concurrency: the order row is locked (`SELECT ... FOR UPDATE`) and the final
 * status transition is a guarded `UPDATE ... WHERE status = 'new'`, so two
 * concurrent /start calls on the same order can never both provision a
 * contract — the loser's guarded UPDATE affects 0 rows and raises a
 * ValidationError instead of committing a duplicate active RADIUS account.
 *
 * @param {number} orderId
 * @param {object} [options]
 * @param {number|null} [options.orgId]
 * @param {number|null} [options.userId] - Accepted for call-site symmetry with
 *   the route's own auditLog.log call; no column on service_orders records it.
 * @returns {Promise<{ order: object, contract: object|null, provisioning: object|undefined }>}
 */
async function startOrder(orderId, { orgId = null } = {}) {
  // ---- Pre-checks that don't need to hold the row lock ----
  const preOrder = await ServiceOrder.findById(orderId, orgId);
  if (!preOrder) throw new NotFoundError('Service order');
  if (preOrder.status !== 'new') {
    throw new ValidationError(`Invalid service order transition: ${preOrder.status} → in_process`);
  }
  if (!preOrder.plan_id) {
    throw new ValidationError('Service order has no plan — set a plan before starting');
  }

  // Resolve the client: prefer an already-linked client, otherwise resolve
  // (and if needed convert) the linked lead. convertLead runs its own
  // transaction and guards against double-conversion (its "already converted"
  // check), so calling it here — outside the row lock taken below — is safe
  // even under a rare concurrent double /start.
  let clientId = preOrder.client_id || null;
  if (!clientId) {
    if (!preOrder.lead_id) {
      throw new ValidationError('Service order has no client or lead — link one before starting');
    }
    const lead = await Lead.findById(preOrder.lead_id, orgId);
    if (!lead) throw new NotFoundError('Lead');
    if (lead.converted_client_id) {
      clientId = lead.converted_client_id;
    } else {
      const { client } = await convertLead(preOrder.lead_id, orgId);
      clientId = client.id;
    }
  }

  // Defect-hardening: never trust a client_id carried on the order row (it may
  // have been set on create/PATCH without an org check) — confirm it belongs
  // to THIS organization before provisioning anything against it.
  const client = await Client.findById(clientId, orgId);
  if (!client) throw new ValidationError('Client not found in this organization');

  // ---- Single transaction: lock the order row, create + provision the
  // contract (new_install only), and transition the order atomically. ----
  const conn = await db.getConnection();
  let contract = null;
  let provisioning;
  let updatedOrder;
  try {
    await conn.beginTransaction();

    const lockQuery = appendOrgFilter('SELECT * FROM service_orders WHERE id = ?', [orderId], orgId);
    const [lockedRows] = await conn.query(`${lockQuery.sql} FOR UPDATE`, lockQuery.params);
    const order = lockedRows[0];
    if (!order) throw new NotFoundError('Service order');
    if (order.status !== 'new') {
      throw new ValidationError(`Invalid service order transition: ${order.status} → in_process`);
    }

    let contractIdToLink = order.contract_id || null;

    if (order.order_type === 'new_install' && !order.contract_id) {
      // A new contract may only run on a live (non-archived) plan that
      // belongs to this org, or a global plan (organization_id IS NULL) —
      // mirrors AND org-scopes routes/contracts.js#assertPlanSelectable
      // (that helper itself has no org filter; duplicated here rather than
      // imported to avoid a route->service import cycle and to close the
      // cross-org gap for this new code path specifically). The org branch is
      // skipped entirely when orgId is null (single-tenant/no active-org
      // context), matching every other org-scoped lookup in this file.
      let planSql = 'SELECT id FROM plans WHERE id = ? AND deleted_at IS NULL';
      const planParams = [order.plan_id];
      if (orgId !== null) {
        planSql += ' AND (organization_id = ? OR organization_id IS NULL)';
        planParams.push(orgId);
      }
      const [planRows] = await conn.query(planSql, planParams);
      if (!planRows[0]) {
        throw new AppError(
          'This plan is archived, unavailable, or belongs to a different organization; a contract cannot be assigned to it.',
          422, 'PLAN_ARCHIVED',
        );
      }

      const contractData = {
        organization_id: orgId,
        client_id: clientId,
        plan_id: order.plan_id,
        connection_type: 'pppoe',
        start_date: new Date().toISOString().slice(0, 10),
        status: 'pending',
      };
      const cols = Object.keys(contractData);
      const [ins] = await conn.query(
        `INSERT INTO contracts (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        Object.values(contractData),
      );
      const contractId = ins.insertId;

      const [clientRows] = await conn.query('SELECT name FROM clients WHERE id = ? LIMIT 1', [clientId]);
      const seed = clientRows[0] && clientRows[0].name;

      provisioning = await provisioningService.provisionNewContract(
        conn,
        { id: contractId, ...contractData },
        { seed },
      );

      const [contractRows] = await conn.query('SELECT * FROM contracts WHERE id = ?', [contractId]);
      contract = contractRows[0];
      contractIdToLink = contractId;
    }

    const setClauses = ['status = ?', 'started_at = NOW()'];
    const setParams = ['in_process'];
    if (clientId !== order.client_id) { setClauses.push('client_id = ?'); setParams.push(clientId); }
    if (contractIdToLink && contractIdToLink !== order.contract_id) { setClauses.push('contract_id = ?'); setParams.push(contractIdToLink); }
    setParams.push(orderId);

    const [result] = await conn.query(
      `UPDATE service_orders SET ${setClauses.join(', ')} WHERE id = ? AND status = 'new'`,
      setParams,
    );
    if (result.affectedRows === 0) {
      // Lost a concurrency race (another /start already transitioned this
      // order between our lock and this UPDATE — shouldn't happen given the
      // row lock above, but guarded defensively rather than trusting it).
      throw new ValidationError('Service order was modified concurrently — please retry');
    }

    await conn.commit();

    const [rows] = await db.query('SELECT * FROM service_orders WHERE id = ?', [orderId]);
    updatedOrder = rows[0];
    logger.info({ orderId, contractId: contract?.id || null }, 'Service order started');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { order: updatedOrder, contract, provisioning };
}

/**
 * Complete a service order: in_process -> done (migration 380). Activates the
 * linked `pending` contract (if any) and, when `billing === 'create_invoice'`,
 * raises a one-off issued invoice for the installation fee
 * (billingService.createOneOffInvoice, on the SAME connection so it commits
 * or rolls back atomically with the contract activation and the status
 * transition). `billing === 'already_paid'` skips invoicing entirely.
 *
 * All `create_invoice` input validation runs BEFORE any write (before the
 * contract is touched), so a 422 (e.g. a missing/invalid installation_fee)
 * never leaves the contract activated with the order stuck in_process.
 *
 * @param {number} orderId
 * @param {object} options
 * @param {number|null} [options.orgId]
 * @param {string} options.billing - already_paid | create_invoice
 * @param {number|null} [options.installationFee] - Required when billing = create_invoice
 * @param {string|null} [options.description]
 * @returns {Promise<{ order: object, invoice: object|null }>}
 */
async function completeOrder(orderId, { orgId = null, billing, installationFee = null, description = null } = {}) {
  // ---- Validate FIRST, before any write ----
  const preOrder = await ServiceOrder.findById(orderId, orgId);
  if (!preOrder) throw new NotFoundError('Service order');
  if (preOrder.status !== 'in_process') {
    throw new ValidationError(`Invalid service order transition: ${preOrder.status} → done`);
  }

  let fee = null;
  let invoiceDescription = null;
  let invoiceCurrency = null;
  if (billing === 'create_invoice') {
    if (!preOrder.client_id) {
      throw new ValidationError('Service order has no client — cannot raise an installation invoice');
    }
    // Defect-hardening: confirm the client actually belongs to this org
    // before raising an invoice against it.
    const client = await Client.findById(preOrder.client_id, orgId);
    if (!client) throw new ValidationError('Client not found in this organization');

    fee = parseFloat(installationFee);
    if (!(fee > 0)) {
      throw new ValidationError('installation_fee must be greater than 0 to create an invoice');
    }
    invoiceDescription = description && description.trim() ? description.trim() : 'Installation fee';

    // Resolve currency from the order's plan (matches the currency the
    // contract's OWN recurring invoices use) so the installation invoice
    // doesn't land in a different currency than the rest of that client's
    // ledger; falls back to the org default when there's no plan.
    if (preOrder.plan_id) {
      const [planRows] = await db.query('SELECT currency FROM plans WHERE id = ?', [preOrder.plan_id]);
      invoiceCurrency = planRows[0]?.currency || null;
    }
  }

  // ---- Single transaction: lock the order row, activate the contract,
  // create the invoice, and transition the order — all-or-nothing. ----
  const conn = await db.getConnection();
  let updatedOrder;
  let invoice = null;
  try {
    await conn.beginTransaction();

    const lockQuery = appendOrgFilter('SELECT * FROM service_orders WHERE id = ?', [orderId], orgId);
    const [lockedRows] = await conn.query(`${lockQuery.sql} FOR UPDATE`, lockQuery.params);
    const order = lockedRows[0];
    if (!order) throw new NotFoundError('Service order');
    if (order.status !== 'in_process') {
      throw new ValidationError(`Invalid service order transition: ${order.status} → done`);
    }

    if (order.contract_id) {
      // Guarded UPDATE: only a still-pending contract is activated here. If
      // the row IS pending but the RADIUS-consistency trigger rejects the
      // activation (trg_contracts_radius_consistency_bu, e.g. the RADIUS
      // account was somehow removed after start), the SIGNAL 45000 throws
      // here and rolls back the whole transaction — app.js's global error
      // handler already maps ER_SIGNAL_EXCEPTION/errno 1644 to a 422
      // (src/app.js:732-737), so it propagates as a client error, not a 500.
      await conn.query(
        "UPDATE contracts SET status = 'active' WHERE id = ? AND status = 'pending'",
        [order.contract_id],
      );
    }

    if (billing === 'create_invoice') {
      invoice = await billingService.createOneOffInvoice({
        orgId,
        clientId: order.client_id,
        contractId: order.contract_id || null,
        description: invoiceDescription,
        amount: fee,
        currency: invoiceCurrency,
        conn,
      });
    }

    const [result] = await conn.query(
      "UPDATE service_orders SET status = 'done', completed_at = NOW() WHERE id = ? AND status = 'in_process'",
      [orderId],
    );
    if (result.affectedRows === 0) {
      throw new ValidationError('Service order was modified concurrently — please retry');
    }

    await conn.commit();

    const [rows] = await db.query('SELECT * FROM service_orders WHERE id = ?', [orderId]);
    updatedOrder = rows[0];
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Emit AFTER commit so a notification-hook failure can never roll back the
  // billing/contract-activation transaction above.
  await emitActivation(updatedOrder, orgId).catch(err =>
    logger.warn({ err: err.message, orderId }, 'Failed to emit service_order.activated'));

  return { order: updatedOrder, invoice };
}

/**
 * Cancel a service order: allowed from new or in_process (migration 380). If
 * a `pending` contract was auto-created by startOrder, cancel it too (the FSM
 * trigger permits pending -> cancelled) and deactivate its RADIUS account —
 * `radiusServerService.findSubscriber` only authenticates `status = 'active'`
 * rows, so the PPPoE credentials that were already displayed to the
 * technician would otherwise still authenticate on the NAS after the order is
 * cancelled. A contract in any OTHER status (active, already terminated, …)
 * is left completely untouched — cancelling a service order must never
 * cancel a contract that predates it or that a technician deliberately kept
 * in service (upgrade/relocation/etc. orders manually link an existing
 * contract via PATCH, not via startOrder).
 *
 * @param {number} orderId
 * @param {object} [options]
 * @param {number|null} [options.orgId]
 * @returns {Promise<{ order: object, contractCancelled: boolean }>}
 */
async function cancelOrder(orderId, { orgId = null } = {}) {
  const conn = await db.getConnection();
  let updatedOrder;
  let contractCancelled = false;
  let contractIdForDisconnect = null;
  try {
    await conn.beginTransaction();

    const lockQuery = appendOrgFilter('SELECT * FROM service_orders WHERE id = ?', [orderId], orgId);
    const [lockedRows] = await conn.query(`${lockQuery.sql} FOR UPDATE`, lockQuery.params);
    const order = lockedRows[0];
    if (!order) throw new NotFoundError('Service order');

    const allowed = ['new', 'in_process'];
    if (!allowed.includes(order.status)) {
      throw new ValidationError(`Invalid service order transition: ${order.status} → cancelled`);
    }

    if (order.contract_id) {
      const [contractRows] = await conn.query('SELECT * FROM contracts WHERE id = ? FOR UPDATE', [order.contract_id]);
      const contract = contractRows[0];
      if (contract && contract.status === 'pending') {
        await conn.query(
          "UPDATE contracts SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
          [order.contract_id],
        );
        // Deactivate any RADIUS account tied to this contract so it stops
        // authenticating new PPPoE sessions (radius.status is a separate
        // column from contracts.status — see radiusServerService#findSubscriber).
        await conn.query(
          "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
          [order.contract_id],
        );
        contractCancelled = true;
        contractIdForDisconnect = order.contract_id;
      }
      // Any other contract status (active, terminated, already cancelled, …)
      // is left untouched — see function doc.
    }

    const [result] = await conn.query(
      "UPDATE service_orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = ? AND status IN ('new','in_process')",
      [orderId],
    );
    if (result.affectedRows === 0) {
      throw new ValidationError('Service order was modified concurrently — please retry');
    }

    await conn.commit();

    const [rows] = await db.query('SELECT * FROM service_orders WHERE id = ?', [orderId]);
    updatedOrder = rows[0];
    logger.info({ orderId, contractCancelled }, 'Service order cancelled');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (contractIdForDisconnect) {
    // Best-effort CoA Disconnect-Request for any currently-live session —
    // never blocks or rolls back the cancel itself (mirrors the non-fatal CoA
    // pattern already used by suspensionService.suspendContract/terminate).
    try {
      const suspensionService = require('./suspensionService');
      await suspensionService.sendRadiusDisconnect(contractIdForDisconnect);
    } catch (err) {
      logger.warn({ err: err.message, orderId }, 'Failed to send RADIUS disconnect on service-order cancel');
    }
  }

  return { order: updatedOrder, contractCancelled };
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
      -- Only count days for invoices that are ACTUALLY overdue (issued + past due);
      -- otherwise old PAID invoices made every long-tenured client look 400+ days overdue.
      COALESCE(MAX(CASE WHEN i.status = 'issued' AND i.due_date < NOW() THEN DATEDIFF(NOW(), i.due_date) END), 0) AS max_days_overdue
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
  nextOrderNumber,
  seedDefaultTasks,
  convertLead,
  startOrder,
  completeOrder,
  cancelOrder,
  churnReport,
  atRiskClients,
  winbackTargets,
};
